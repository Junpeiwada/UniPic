const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const path = require('path');

// Workerのエラーハンドリング
process.on('uncaughtException', (error) => {
  console.error('[Worker] Uncaught Exception:', error);
  console.error('[Worker] Stack:', error.stack);
  if (parentPort) {
    parentPort.postMessage({
      type: 'error',
      error: error.message,
      stack: error.stack
    });
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Worker] Unhandled Rejection at:', promise, 'reason:', reason);
  if (parentPort) {
    parentPort.postMessage({
      type: 'error',
      error: reason.message || reason,
      stack: reason.stack
    });
  }
});

console.log('[Worker] Worker スレッド開始');

// Sharp の動作確認
try {
  console.log('[Worker] Sharp バージョン:', sharp.versions);
  console.log('[Worker] Sharp プラットフォーム:', sharp.platform());
} catch (error) {
  console.error('[Worker] Sharp 初期化エラー:', error);
  if (parentPort) {
    parentPort.postMessage({
      type: 'error',
      error: `Sharp initialization failed: ${error.message}`,
      stack: error.stack
    });
  }
}

// ファイルのハッシュ値を計算
function calculateFileHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('md5');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

// pHashを計算する関数（Sharp使用、最適化版）
async function calculatePHash(filePath) {
  try {
    console.log(`[Worker] Sharp処理開始: ${path.basename(filePath)}`);
    // Sharpで画像を32x32のグレースケールに変換し、ピクセルデータを取得
    const { data, info } = await sharp(filePath)
      .resize(32, 32)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    // ピクセル配列に変換（最適化）
    const pixels = new Uint8Array(data);
    
    // 8x8の低周波成分を取得（最適化DCT）
    const dctData = new Float32Array(64);
    let dctIndex = 0;
    
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        let sum = 0;
        for (let i = 0; i < 32; i++) {
          const cos1 = Math.cos((2 * i + 1) * x * Math.PI / 64);
          for (let j = 0; j < 32; j++) {
            const cos2 = Math.cos((2 * j + 1) * y * Math.PI / 64);
            sum += pixels[i * 32 + j] * cos1 * cos2;
          }
        }
        dctData[dctIndex++] = sum;
      }
    }
    
    // 左上の8x8からDC成分を除いた63要素の中央値を計算（最適化）
    const dctWithoutDC = new Float32Array(63);
    for (let i = 1; i < 64; i++) {
      dctWithoutDC[i-1] = dctData[i];
    }
    dctWithoutDC.sort((a, b) => a - b);
    const median = dctWithoutDC[31]; // 63要素の中央値は31番目
    
    // 各要素が中央値より大きいかどうかでビットを決定（最適化）
    let hash = '';
    for (let i = 1; i < 64; i++) { // DC成分をスキップ
      hash += dctData[i] > median ? '1' : '0';
    }
    
    return hash;
  } catch (error) {
    console.error(`pHash計算エラー ${filePath}:`, error.message);
    // エラーが発生した場合、代替ハッシュを使用
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

// ワーカースレッドのメイン処理
async function processFiles(files) {
  const results = [];
  const workerStartTime = Date.now();
  
  console.log(`[Worker] 開始: ${files.length}ファイルを処理`);
  
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const fileStartTime = Date.now();
    
    try {
      const hashStartTime = Date.now();
      const fileHash = calculateFileHash(filePath);
      const hashTime = Date.now() - hashStartTime;
      
      const pHashStartTime = Date.now();
      const pHash = await calculatePHash(filePath);
      const pHashTime = Date.now() - pHashStartTime;
      
      const totalFileTime = Date.now() - fileStartTime;
      
      if (i % 10 === 0 || totalFileTime > 500) { // 10ファイルごと、または500ms以上かかった場合
        console.log(`[Worker] ${i+1}/${files.length} ${path.basename(filePath)} - Hash:${hashTime}ms, pHash:${pHashTime}ms, Total:${totalFileTime}ms`);
      }
      
      // 進捗を親スレッドに送信
      parentPort.postMessage({
        type: 'progress',
        filePath: filePath,
        processed: true,
        processingTime: totalFileTime
      });
      
      if (pHash) {
        results.push({
          path: filePath,
          fileHash: fileHash,
          pHash: pHash
        });
      }
    } catch (error) {
      const errorTime = Date.now() - fileStartTime;
      console.error(`[Worker] Error processing ${path.basename(filePath)} (${errorTime}ms):`, error.message);
      
      // エラーでも進捗を送信
      parentPort.postMessage({
        type: 'progress',
        filePath: filePath,
        processed: true,
        error: true,
        processingTime: errorTime
      });
    }
  }
  
  const totalWorkerTime = Date.now() - workerStartTime;
  console.log(`[Worker] 完了: ${results.length}/${files.length}ファイル処理済み (${totalWorkerTime}ms, 平均:${Math.round(totalWorkerTime/files.length)}ms/ファイル)`);
  
  // 完了した結果を送信
  parentPort.postMessage({
    type: 'completed',
    results: results,
    processingTime: totalWorkerTime
  });
}

// ワーカーデータから処理対象ファイルを受け取って処理開始
if (workerData && workerData.files) {
  processFiles(workerData.files);
}