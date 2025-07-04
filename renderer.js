const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

let selectedFolder = null;
let currentDuplicates = [];

// DOM要素の取得
const selectFolderBtn = document.getElementById('selectFolderBtn');
const scanBtn = document.getElementById('scanBtn');
const rescanBtn = document.getElementById('rescanBtn');
const selectedFolderSpan = document.getElementById('selectedFolder');
const statusDiv = document.getElementById('status');
const progressDiv = document.getElementById('progress');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const duplicatesContainer = document.getElementById('duplicatesContainer');
const dropZone = document.getElementById('dropZone');
const similaritySlider = document.getElementById('similaritySlider');
const similarityValue = document.getElementById('similarityValue');

// 類似度スライダーの値変更
similaritySlider.addEventListener('input', (e) => {
    similarityValue.textContent = e.target.value;
});

// フォルダ選択の共通処理
function selectFolder(folderPath, autoScan = false) {
    if (folderPath) {
        selectedFolder = folderPath;
        selectedFolderSpan.textContent = `選択済み: ${path.basename(folderPath)}`;
        scanBtn.disabled = false;
        rescanBtn.disabled = false;
        duplicatesContainer.innerHTML = '';
        hideStatus();
        
        // 自動スキャンが有効な場合はスキャンを開始
        if (autoScan) {
            performScan();
        }
    }
}

// フォルダ選択
selectFolderBtn.addEventListener('click', async () => {
    const folderPath = await ipcRenderer.invoke('select-folder');
    selectFolder(folderPath);
});

// ドラッグアンドドロップ機能
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        // 最後にドロップされたアイテムを処理
        const file = files[files.length - 1];
        
        // フォルダかどうかを判定
        const fs = require('fs');
        try {
            const stats = fs.statSync(file.path);
            if (stats.isDirectory()) {
                // フォルダの場合 - 自動スキャンを有効にする
                selectFolder(file.path, true);
                showStatus(`フォルダ「${path.basename(file.path)}」を選択し、スキャンを開始します...`, 'info');
            } else {
                // ファイルの場合、親フォルダを選択 - 自動スキャンを有効にする
                const folderPath = path.dirname(file.path);
                selectFolder(folderPath, true);
                showStatus(`ファイルの親フォルダ「${path.basename(folderPath)}」を選択し、スキャンを開始します...`, 'info');
            }
        } catch (error) {
            showStatus(`選択したアイテムを読み込めませんでした: ${error.message}`, 'error');
        }
    }
});

// スキャン処理の共通関数
async function performScan() {
    if (!selectedFolder) return;
    
    try {
        scanBtn.disabled = true;
        rescanBtn.disabled = true;
        selectFolderBtn.disabled = true;
        
        showStatus('画像ファイルをスキャンしています...', 'info');
        showProgress(0);
        
        // 画像ファイルのスキャン
        const imageFiles = await ipcRenderer.invoke('scan-images', selectedFolder);
        
        if (imageFiles.length === 0) {
            showStatus('画像ファイルが見つかりませんでした。', 'warning');
            return;
        }
        
        showStatus(`${imageFiles.length}個の画像ファイルが見つかりました。重複を検出中...`, 'info');
        showProgress(50);
        
        // 重複検出（類似度設定を使用）
        const similarityThreshold = parseInt(similaritySlider.value);
        const duplicates = await ipcRenderer.invoke('find-duplicates', imageFiles, similarityThreshold);
        
        showProgress(100);
        
        if (duplicates.length === 0) {
            showStatus('重複する画像は見つかりませんでした。', 'success');
            duplicatesContainer.innerHTML = '';
        } else {
            showStatus(`${duplicates.length}組の重複画像が見つかりました。`, 'success');
            displayDuplicates(duplicates);
        }
        
    } catch (error) {
        showStatus(`エラーが発生しました: ${error.message}`, 'error');
    } finally {
        scanBtn.disabled = false;
        rescanBtn.disabled = false;
        selectFolderBtn.disabled = false;
        hideProgress();
    }
}

// スキャン開始
scanBtn.addEventListener('click', performScan);

// 再スキャン
rescanBtn.addEventListener('click', performScan);

// ステータス表示
function showStatus(message, type = 'info') {
    statusDiv.style.display = 'block';
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    
    const colors = {
        info: '#e8f4f8',
        success: '#e8f5e8',
        warning: '#fff3cd',
        error: '#f8d7da'
    };
    
    const borderColors = {
        info: '#007acc',
        success: '#28a745',
        warning: '#ffc107',
        error: '#dc3545'
    };
    
    statusDiv.style.backgroundColor = colors[type] || colors.info;
    statusDiv.style.borderLeftColor = borderColors[type] || borderColors.info;
}

function hideStatus() {
    statusDiv.style.display = 'none';
}

// プログレスバー表示
function showProgress(percent) {
    progressDiv.style.display = 'block';
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `${percent}%`;
}

function hideProgress() {
    setTimeout(() => {
        progressDiv.style.display = 'none';
    }, 1000);
}

// 重複画像の表示
function displayDuplicates(duplicates) {
    currentDuplicates = duplicates;
    duplicatesContainer.innerHTML = '';
    
    duplicates.forEach((duplicate, index) => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'duplicate-group';
        
        const title = document.createElement('h3');
        title.textContent = `重複グループ ${index + 1}`;
        groupDiv.appendChild(title);
        
        // 類似性タイプを表示
        const similarityInfo = document.createElement('div');
        similarityInfo.className = 'similarity-info';
        similarityInfo.style.marginBottom = '15px';
        similarityInfo.style.padding = '8px 12px';
        similarityInfo.style.borderRadius = '5px';
        similarityInfo.style.fontWeight = 'bold';
        similarityInfo.style.fontSize = '14px';
        
        if (duplicate.type === 'identical') {
            similarityInfo.textContent = duplicate.similarity;
            similarityInfo.style.backgroundColor = '#ffebee';
            similarityInfo.style.color = '#c62828';
            similarityInfo.style.border = '1px solid #ef5350';
        } else {
            similarityInfo.textContent = duplicate.similarity;
            similarityInfo.style.backgroundColor = '#e3f2fd';
            similarityInfo.style.color = '#1565c0';
            similarityInfo.style.border = '1px solid #42a5f5';
        }
        groupDiv.appendChild(similarityInfo);
        
        const imagesDiv = document.createElement('div');
        imagesDiv.className = 'duplicate-images';
        
        duplicate.files.forEach((filePath, fileIndex) => {
            const imageItem = document.createElement('div');
            imageItem.className = 'image-item';
            
            const img = document.createElement('img');
            img.src = `file://${filePath}`;
            img.alt = path.basename(filePath);
            img.style.cursor = 'pointer';
            img.title = 'クリックで拡大表示';
            
            // 画像クリックイベントを追加
            img.onclick = () => openImageViewer(duplicate.files, fileIndex);
            
            const info = document.createElement('div');
            info.className = 'image-info';
            info.innerHTML = `
                <div><strong>ファイル名:</strong> ${path.basename(filePath)}</div>
                <div><strong>パス:</strong> ${filePath}</div>
                <div><strong>サイズ:</strong> ${getFileSize(filePath)}</div>
            `;
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.textContent = '削除';
            deleteBtn.onclick = () => deleteFile(filePath, imageItem);
            
            imageItem.appendChild(img);
            imageItem.appendChild(info);
            imageItem.appendChild(deleteBtn);
            imagesDiv.appendChild(imageItem);
        });
        
        groupDiv.appendChild(imagesDiv);
        duplicatesContainer.appendChild(groupDiv);
    });
}

// ファイルサイズの取得
function getFileSize(filePath) {
    try {
        const stats = fs.statSync(filePath);
        const fileSizeInBytes = stats.size;
        const fileSizeInMB = (fileSizeInBytes / (1024 * 1024)).toFixed(2);
        return `${fileSizeInMB} MB`;
    } catch (error) {
        return 'サイズ不明';
    }
}

// 画像ビューアを開く
async function openImageViewer(images, startIndex) {
    const imageData = {
        images: images,
        startIndex: startIndex
    };
    
    try {
        await ipcRenderer.invoke('open-image-viewer', imageData);
    } catch (error) {
        showStatus(`画像ビューアを開けませんでした: ${error.message}`, 'error');
    }
}

// ファイル削除
async function deleteFile(filePath, imageItem) {
    const fileName = path.basename(filePath);
    
    if (confirm(`本当に「${fileName}」を削除しますか？\n\n削除されたファイルは復元できません。`)) {
        try {
            const result = await ipcRenderer.invoke('delete-file', filePath);
            
            if (result.success) {
                imageItem.style.opacity = '0.5';
                imageItem.style.pointerEvents = 'none';
                
                const deletedLabel = document.createElement('div');
                deletedLabel.textContent = '削除済み';
                deletedLabel.style.color = 'red';
                deletedLabel.style.fontWeight = 'bold';
                deletedLabel.style.marginTop = '10px';
                imageItem.appendChild(deletedLabel);
                
                showStatus(`ファイル「${fileName}」を削除しました。`, 'success');
                
                setTimeout(() => {
                    hideStatus();
                }, 3000);
            } else {
                showStatus(`ファイルの削除に失敗しました: ${result.error}`, 'error');
            }
        } catch (error) {
            showStatus(`エラーが発生しました: ${error.message}`, 'error');
        }
    }
}

// ハッシュ計算進捗を受け取る
ipcRenderer.on('hash-progress', (event, progressData) => {
    const { current, total, currentFile, percentage, phase, error } = progressData;
    
    // プログレスバーを更新
    showProgress(percentage);
    
    // ステータスメッセージを更新
    let message;
    if (phase === 'ハッシュ計算中') {
        if (error) {
            message = `ハッシュ計算中... ${current}/${total} (${percentage}%) - エラー: ${currentFile}`;
        } else {
            message = `ハッシュ計算中... ${current}/${total} (${percentage}%) - 処理中: ${currentFile}`;
        }
    } else if (phase === '重複検出中') {
        message = `重複検出中... ${percentage}%`;
    } else if (phase === '完了') {
        message = `ハッシュ計算完了 - ${total}ファイル処理済み`;
    }
    
    showStatus(message, 'info');
});

// 比較進捗を受け取る
ipcRenderer.on('comparison-progress', (event, progressData) => {
    const { current, total, percentage, phase } = progressData;
    
    showProgress(percentage);
    showStatus(`${phase}... ${current}/${total}組の比較完了 (${percentage}%)`, 'info');
});

// 画像ビューアからの削除通知を受け取る
ipcRenderer.on('file-deleted', (event, deletedFilePath) => {
    console.log('削除通知を受信:', deletedFilePath);
    
    // メイン画面の重複表示を更新
    const imageItems = document.querySelectorAll('.image-item');
    let found = false;
    
    imageItems.forEach(item => {
        const img = item.querySelector('img');
        if (img) {
            // file:// プロトコルを除去して比較
            const imgPath = decodeURIComponent(img.src.replace('file://', ''));
            const normalizedDeletedPath = deletedFilePath.replace(/\\/g, '/');
            const normalizedImgPath = imgPath.replace(/\\/g, '/');
            
            console.log('比較中 - 削除パス:', normalizedDeletedPath);
            console.log('比較中 - 画像パス:', normalizedImgPath);
            
            if (normalizedImgPath === normalizedDeletedPath || normalizedImgPath.endsWith(normalizedDeletedPath)) {
                // 既に削除済みマークがある場合はスキップ
                if (item.querySelector('.deleted-marker')) {
                    return;
                }
                
                item.style.opacity = '0.5';
                item.style.pointerEvents = 'none';
                
                const deletedLabel = document.createElement('div');
                deletedLabel.className = 'deleted-marker';
                deletedLabel.textContent = '削除済み';
                deletedLabel.style.color = 'red';
                deletedLabel.style.fontWeight = 'bold';
                deletedLabel.style.marginTop = '10px';
                deletedLabel.style.textAlign = 'center';
                deletedLabel.style.backgroundColor = '#ffe6e6';
                deletedLabel.style.padding = '5px';
                deletedLabel.style.borderRadius = '3px';
                deletedLabel.style.border = '1px solid #ff9999';
                item.appendChild(deletedLabel);
                
                console.log('削除マークを追加しました');
                found = true;
            }
        }
    });
    
    if (found) {
        showStatus(`ファイル「${path.basename(deletedFilePath)}」が削除されました。`, 'success');
    } else {
        console.log('削除対象の画像が見つかりませんでした');
        showStatus(`画像ビューアからファイルが削除されました。`, 'info');
    }
    
    setTimeout(() => {
        hideStatus();
    }, 3000);
});