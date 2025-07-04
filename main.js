const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const os = require('os');
const { Worker } = require('worker_threads');

let mainWindow;

// エラーハンドリングとログ設定
process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught Exception:', error);
  console.error('[Main] Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Main] Unhandled Rejection at:', promise, 'reason:', reason);
});

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
  app.quit();
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

// Worker Threadsを使用した並列処理（Sharp版、最適化）
async function processFilesWithWorkers(files) {
  const startTime = Date.now();
  const cpuCount = os.cpus().length;
  
  // ファイル数に基づいてワーカー数を動的調整
  let workerCount;
  if (files.length < 20) {
    workerCount = Math.min(2, cpuCount); // 少ないファイルは2ワーカーまで
  } else if (files.length < 100) {
    workerCount = Math.min(4, cpuCount); // 中程度は4ワーカーまで
  } else {
    workerCount = Math.min(cpuCount, 8); // 大量ファイルは最大8ワーカー
  }
  
  const filesPerWorker = Math.ceil(files.length / workerCount);
  
  console.log(`[Main] Sharp マルチスレッド処理開始: ${workerCount}ワーカー (CPU:${cpuCount}コア), ${files.length}ファイル, ワーカーあたり平均:${filesPerWorker}ファイル`);
  
  const results = [];
  let processedCount = 0;
  const total = files.length;
  let totalProcessingTime = 0;
  
  // ワーカーを作成してファイルを分散処理
  const workerPromises = [];
  
  for (let i = 0; i < workerCount; i++) {
    const startIndex = i * filesPerWorker;
    const endIndex = Math.min(startIndex + filesPerWorker, files.length);
    const workerFiles = files.slice(startIndex, endIndex);
    
    if (workerFiles.length === 0) continue;
    
    const workerPromise = new Promise((resolve, reject) => {
      const workerStartTime = Date.now();
      const workerPath = path.join(__dirname, 'hash-worker.js');
      
      console.log(`[Main] Worker ${i+1} パス: ${workerPath}`);
      console.log(`[Main] Worker ${i+1} パス存在確認: ${fs.existsSync(workerPath)}`);
      
      try {
        const worker = new Worker(workerPath, {
          workerData: { files: workerFiles }
        });
        
        console.log(`[Main] Worker ${i+1} 開始: ${workerFiles.length}ファイル (${startIndex}-${endIndex-1})`);
        
        worker.on('message', (message) => {
          if (message.type === 'progress') {
            processedCount++;
            if (message.processingTime) {
              totalProcessingTime += message.processingTime;
            }
            
            // 10ファイルごとにログ出力
            if (processedCount % 10 === 0) {
              const avgTime = totalProcessingTime / processedCount;
              const remaining = total - processedCount;
              const estimatedRemaining = (remaining * avgTime) / 1000;
              console.log(`[Main] 進捗: ${processedCount}/${total} (${Math.round(processedCount/total*100)}%) - 平均:${Math.round(avgTime)}ms/ファイル, 残り推定:${Math.round(estimatedRemaining)}秒`);
            }
            
            // 進捗を送信
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('hash-progress', {
                current: processedCount,
                total: total,
                currentFile: path.basename(message.filePath),
                percentage: Math.round((processedCount / total) * 100),
                error: message.error || false
              });
            }
          } else if (message.type === 'completed') {
            const workerTime = Date.now() - workerStartTime;
            console.log(`[Main] Worker ${i+1} 完了: ${message.results.length}ファイル処理済み (${workerTime}ms)`);
            worker.terminate();
            resolve(message.results);
          }
        });
        
        worker.on('error', (error) => {
          console.error(`[Main] Worker ${i+1} error:`, error);
          console.error(`[Main] Worker ${i+1} error stack:`, error.stack);
          worker.terminate();
          reject(error);
        });
        
        worker.on('exit', (code) => {
          if (code !== 0) {
            console.error(`[Main] Worker ${i+1} stopped with exit code ${code}`);
          }
        });
        
      } catch (error) {
        console.error(`[Main] Worker ${i+1} 作成エラー:`, error);
        console.error(`[Main] Worker ${i+1} 作成エラースタック:`, error.stack);
        reject(error);
      }
    });
    
    workerPromises.push(workerPromise);
  }
  
  // すべてのワーカーの完了を待つ
  const workerResults = await Promise.all(workerPromises);
  
  // 結果をまとめる
  for (const workerResult of workerResults) {
    results.push(...workerResult);
  }
  
  const totalTime = Date.now() - startTime;
  const avgTime = totalProcessingTime / total;
  const efficiency = totalProcessingTime / (totalTime * workerCount) * 100;
  
  console.log(`[Main] Sharp マルチスレッド処理完了: ${results.length}ファイル処理済み`);
  console.log(`[Main] 総時間: ${totalTime}ms (${Math.round(totalTime/1000)}秒)`);
  console.log(`[Main] 平均ファイル処理時間: ${Math.round(avgTime)}ms`);
  console.log(`[Main] スループット: ${Math.round(total/(totalTime/1000))}ファイル/秒`);
  console.log(`[Main] ワーカー効率: ${Math.round(efficiency)}% (理想値: ${workerCount*100}%)`);
  
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
  
  // Worker Threadsでハッシュ計算
  const fileData = await processFilesWithWorkers(imageFiles);
  
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