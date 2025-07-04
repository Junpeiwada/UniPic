const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const os = require('os');

let mainWindow;

function createWindow() {
  const iconPath = path.join(__dirname, 'icon', 'icon.png');
  console.log('Icon path:', iconPath);
  console.log('Icon exists:', fs.existsSync(iconPath));
  
  // nativeImageを使ってアイコンを読み込み
  const appIcon = nativeImage.createFromPath(iconPath);
  console.log('Icon loaded:', !appIcon.isEmpty());
  
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    icon: appIcon,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  
  // アプリアイコンも設定
  if (process.platform === 'darwin') {
    app.dock.setIcon(appIcon);
  }

  mainWindow.loadFile('index.html');

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// フォルダ選択ダイアログ
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

// 画像ファイルのスキャン
ipcMain.handle('scan-images', async (event, folderPath) => {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
  const imageFiles = [];

  function scanDirectory(dirPath) {
    const files = fs.readdirSync(dirPath);
    
    files.forEach(file => {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        scanDirectory(filePath);
      } else if (imageExtensions.includes(path.extname(file).toLowerCase())) {
        imageFiles.push(filePath);
      }
    });
  }

  scanDirectory(folderPath);
  return imageFiles;
});

// ファイルのハッシュ値を計算
function calculateFileHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('md5');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

// pHashを計算する関数（Sharp使用）
async function calculatePHash(filePath) {
  try {
    // Sharpで画像を32x32のグレースケールに変換し、ピクセルデータを取得
    const { data, info } = await sharp(filePath)
      .resize(32, 32)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    // ピクセル配列に変換
    const pixels = Array.from(data);
    
    // 8x8の低周波成分を取得（簡易DCT）
    const dctData = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        let sum = 0;
        for (let i = 0; i < 32; i++) {
          for (let j = 0; j < 32; j++) {
            const cos1 = Math.cos((2 * i + 1) * x * Math.PI / (2 * 32));
            const cos2 = Math.cos((2 * j + 1) * y * Math.PI / (2 * 32));
            sum += pixels[i * 32 + j] * cos1 * cos2;
          }
        }
        dctData.push(sum);
      }
    }
    
    // 左上の8x8からDC成分を除いた63要素の中央値を計算
    const dctWithoutDC = [...dctData.slice(1)]; // DC成分を除去（元配列を保持するためスプレッド）
    dctWithoutDC.sort((a, b) => a - b);
    const median = dctWithoutDC[Math.floor(dctWithoutDC.length / 2)];
    
    // 各要素が中央値より大きいかどうかでビットを決定
    let hash = '';
    for (let i = 1; i < 64; i++) { // DC成分をスキップ
      hash += dctData[i] > median ? '1' : '0';
    }
    
    return hash;
  } catch (error) {
    console.error(`pHash計算エラー ${filePath}:`, error.message);
    // WebPやその他の形式でエラーが発生した場合、代替ハッシュを使用
    try {
      // ファイルの基本的な情報からハッシュを生成（フォールバック）
      const stats = fs.statSync(filePath);
      const fallbackHash = crypto.createHash('sha256')
        .update(filePath + stats.size + stats.mtime.getTime())
        .digest('hex').substring(0, 63).split('').map(c => parseInt(c, 16) % 2).join('');
      console.log(`フォールバックハッシュを使用: ${filePath}`);
      return fallbackHash;
    } catch (fallbackError) {
      console.error(`フォールバックハッシュ生成エラー ${filePath}:`, fallbackError.message);
      return null;
    }
  }
}

// ハミング距離を計算
function hammingDistance(hash1, hash2) {
  if (hash1.length !== hash2.length) return -1;
  
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) {
      distance++;
    }
  }
  return distance;
}

// 並列処理でファイルを処理
async function processFilesBatch(files, batchSize = 10) {
  const results = [];
  const total = files.length;
  let processed = 0;

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    
    // バッチを並列処理
    const batchPromises = batch.map(async (filePath) => {
      try {
        const fileHash = calculateFileHash(filePath);
        const pHash = await calculatePHash(filePath);
        
        processed++;
        
        // 進捗を送信
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('hash-progress', {
            current: processed,
            total: total,
            currentFile: path.basename(filePath),
            percentage: Math.round((processed / total) * 100)
          });
        }
        
        if (pHash) {
          return {
            path: filePath,
            fileHash: fileHash,
            pHash: pHash
          };
        }
        return null;
      } catch (error) {
        console.error(`Error processing file ${filePath}:`, error);
        processed++;
        
        // エラーでも進捗を更新
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('hash-progress', {
            current: processed,
            total: total,
            currentFile: path.basename(filePath),
            percentage: Math.round((processed / total) * 100),
            error: true
          });
        }
        
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter(result => result !== null));
    
    // バッチ間で少し待機（メモリ負荷軽減）
    if (i + batchSize < files.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  return results;
}

// 重複検出
ipcMain.handle('find-duplicates', async (event, imageFiles, similarityThreshold = 10) => {
  const duplicates = [];
  
  // 進捗初期化
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hash-progress', {
      current: 0,
      total: imageFiles.length,
      currentFile: '',
      percentage: 0,
      phase: 'ハッシュ計算中'
    });
  }
  
  // 並列処理でハッシュ計算
  const cpuCount = os.cpus().length;
  const batchSize = Math.max(1, Math.floor(cpuCount * 2)); // CPU数の2倍のバッチサイズ
  console.log(`並列処理: ${cpuCount}コア、バッチサイズ: ${batchSize}`);
  
  const fileData = await processFilesBatch(imageFiles, batchSize);
  
  // 重複検出フェーズ
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hash-progress', {
      current: fileData.length,
      total: fileData.length,
      currentFile: '',
      percentage: 100,
      phase: '重複検出中'
    });
  }
  
  const processed = new Set();
  let comparisonCount = 0;
  const totalComparisons = (fileData.length * (fileData.length - 1)) / 2;
  
  for (let i = 0; i < fileData.length; i++) {
    if (processed.has(i)) continue;
    
    const similarFiles = [fileData[i]];
    processed.add(i);
    
    for (let j = i + 1; j < fileData.length; j++) {
      if (processed.has(j)) continue;
      
      comparisonCount++;
      
      // 比較進捗を送信（100回に1回）
      if (comparisonCount % 100 === 0 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('comparison-progress', {
          current: comparisonCount,
          total: totalComparisons,
          percentage: Math.round((comparisonCount / totalComparisons) * 100),
          phase: '重複検出中'
        });
      }
      
      // バイナリ同一チェック
      if (fileData[i].fileHash === fileData[j].fileHash) {
        similarFiles.push(fileData[j]);
        processed.add(j);
        continue;
      }
      
      // pHash類似性チェック
      const distance = hammingDistance(fileData[i].pHash, fileData[j].pHash);
      if (distance >= 0 && distance <= similarityThreshold) {
        similarFiles.push(fileData[j]);
        processed.add(j);
      }
    }
    
    // 2つ以上のファイルがある場合のみ重複として扱う
    if (similarFiles.length > 1) {
      // バイナリ同一かpHash類似かを判定
      const isIdentical = similarFiles.every(file => file.fileHash === similarFiles[0].fileHash);
      
      duplicates.push({
        type: isIdentical ? 'identical' : 'similar',
        files: similarFiles.map(file => file.path),
        similarity: isIdentical ? 'バイナリ同一' : `視覚的類似 (距離: ${Math.min(...similarFiles.slice(1).map(file => hammingDistance(similarFiles[0].pHash, file.pHash)))})`
      });
    }
  }

  // 完了通知
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hash-progress', {
      current: fileData.length,
      total: fileData.length,
      percentage: 100,
      phase: '完了'
    });
  }

  return duplicates;
});

// ファイル削除
ipcMain.handle('delete-file', async (event, filePath) => {
  try {
    fs.unlinkSync(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 画像拡大表示ウィンドウ
let imageViewerWindow = null;

ipcMain.handle('open-image-viewer', async (event, imageData) => {
  if (imageViewerWindow) {
    imageViewerWindow.close();
  }

  const iconPath = path.join(__dirname, 'icon', 'icon.png');
  const appIcon = nativeImage.createFromPath(iconPath);
  
  imageViewerWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: appIcon,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    parent: mainWindow,
    modal: false,
    show: false
  });

  // ウィンドウを最大化
  imageViewerWindow.maximize();

  imageViewerWindow.loadFile('image-viewer.html');
  
  imageViewerWindow.once('ready-to-show', () => {
    imageViewerWindow.show();
    imageViewerWindow.webContents.send('load-images', imageData);
  });

  imageViewerWindow.on('closed', () => {
    imageViewerWindow = null;
  });
});

// 画像ビューアからの削除要求
ipcMain.handle('delete-file-from-viewer', async (event, filePath) => {
  try {
    console.log('削除要求受信:', filePath);
    fs.unlinkSync(filePath);
    console.log('ファイル削除完了:', filePath);
    
    // メインウィンドウに削除完了を通知
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('メインウィンドウに削除通知送信:', filePath);
      mainWindow.webContents.send('file-deleted', filePath);
    } else {
      console.log('メインウィンドウが利用できません');
    }
    
    return { success: true };
  } catch (error) {
    console.error('削除エラー:', error);
    return { success: false, error: error.message };
  }
});