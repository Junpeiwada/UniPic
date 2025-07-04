const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

let currentImages = [];
let currentIndex = 0;

// DOM要素の取得
const mainImage = document.getElementById('mainImage');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const closeBtn = document.getElementById('closeBtn');
const deleteBtn = document.getElementById('deleteBtn');
const imageCounter = document.getElementById('imageCounter');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const filePath = document.getElementById('filePath');
const modifiedDate = document.getElementById('modifiedDate');
const createdDate = document.getElementById('createdDate');
const imageResolution = document.getElementById('imageResolution');
const imageFormat = document.getElementById('imageFormat');

// 画像データの読み込み
ipcRenderer.on('load-images', (event, imageData) => {
    currentImages = imageData.images;
    currentIndex = imageData.startIndex || 0;
    displayCurrentImage();
});


// ファイル情報を更新
function updateFileInfo(imagePath) {
    const fileBaseName = path.basename(imagePath);
    const fileExt = path.extname(imagePath).toLowerCase();
    
    fileName.textContent = fileBaseName;
    filePath.textContent = imagePath;
    imageFormat.textContent = fileExt.substring(1).toUpperCase();
    
    // ファイル情報を取得
    try {
        const stats = fs.statSync(imagePath);
        const fileSizeInBytes = stats.size;
        const fileSizeInMB = (fileSizeInBytes / (1024 * 1024)).toFixed(2);
        fileSize.textContent = `${fileSizeInMB} MB`;
        
        // 日時情報をフォーマット
        const formatDate = (date) => {
            return date.toLocaleDateString('ja-JP', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        };
        
        modifiedDate.textContent = formatDate(stats.mtime);
        createdDate.textContent = formatDate(stats.birthtime);
    } catch (error) {
        fileSize.textContent = 'サイズ不明';
        modifiedDate.textContent = '不明';
        createdDate.textContent = '不明';
    }
}

// 画像の解像度を取得
mainImage.addEventListener('load', () => {
    imageResolution.textContent = `${mainImage.naturalWidth} × ${mainImage.naturalHeight}`;
});

// 前の画像
prevBtn.addEventListener('click', () => {
    if (currentIndex > 0) {
        currentIndex--;
        displayCurrentImage();
    }
});

// 次の画像
nextBtn.addEventListener('click', () => {
    if (currentIndex < currentImages.length - 1) {
        currentIndex++;
        displayCurrentImage();
    }
});

// 削除
deleteBtn.addEventListener('click', async () => {
    if (currentImages.length === 0) return;
    
    const currentImagePath = currentImages[currentIndex];
    const fileName = path.basename(currentImagePath);
    
    if (confirm(`本当に「${fileName}」を削除しますか？\n\n削除されたファイルは復元できません。`)) {
        try {
            console.log('削除要求送信:', currentImagePath);
            const result = await ipcRenderer.invoke('delete-file-from-viewer', currentImagePath);
            
            if (result.success) {
                console.log('削除成功:', currentImagePath);
                // 配列から削除された画像を除去
                currentImages.splice(currentIndex, 1);
                
                // 画像がなくなった場合はウィンドウを閉じる
                if (currentImages.length === 0) {
                    window.close();
                    return;
                }
                
                // インデックスを調整
                if (currentIndex >= currentImages.length) {
                    currentIndex = currentImages.length - 1;
                }
                
                // 次の画像を表示
                displayCurrentImage();
                
                // 成功メッセージを短時間表示
                const originalTitle = document.querySelector('.viewer-title').textContent;
                document.querySelector('.viewer-title').textContent = `削除完了: ${fileName}`;
                setTimeout(() => {
                    document.querySelector('.viewer-title').textContent = originalTitle;
                }, 2000);
                
            } else {
                alert(`ファイルの削除に失敗しました: ${result.error}`);
            }
        } catch (error) {
            alert(`エラーが発生しました: ${error.message}`);
        }
    }
});

// 閉じる
closeBtn.addEventListener('click', () => {
    window.close();
});

// キーボードショートカット
document.addEventListener('keydown', (e) => {
    // フォーカスが入力フィールドにある場合はショートカットを無効にする
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }
    
    switch (e.key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
            e.preventDefault();
            if (!prevBtn.disabled) {
                prevBtn.click();
            }
            break;
        case 'ArrowRight':
        case 'd':
        case 'D':
            e.preventDefault();
            if (!nextBtn.disabled) {
                nextBtn.click();
            }
            break;
        case 'Delete':
        case 'Backspace':
            e.preventDefault();
            deleteBtn.click();
            break;
        case 'Escape':
            e.preventDefault();
            closeBtn.click();
            break;
        case ' ':
        case 'Enter':
            e.preventDefault();
            // スペースキーまたはEnterで画像をクリック（ズーム切り替え）
            mainImage.click();
            break;
        case 'f':
        case 'F':
            e.preventDefault();
            // フルスクリーン切り替え
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                document.documentElement.requestFullscreen();
            }
            break;
    }
});

// 画像をクリックしたときのズーム機能
let isZoomed = false;
mainImage.addEventListener('click', () => {
    if (!isZoomed) {
        // ズームイン（等倍表示）
        mainImage.classList.remove('fitted');
        mainImage.classList.add('zoomed');
        mainImage.style.maxWidth = 'none';
        mainImage.style.maxHeight = 'none';
        mainImage.style.width = 'auto';
        mainImage.style.height = 'auto';
        mainImage.style.objectFit = 'none';
        isZoomed = true;
    } else {
        // ズームアウト（フィット表示）
        mainImage.classList.remove('zoomed');
        mainImage.classList.add('fitted');
        mainImage.style.maxWidth = 'calc(100% - 20px)';
        mainImage.style.maxHeight = 'calc(100% - 20px)';
        mainImage.style.width = 'auto';
        mainImage.style.height = 'auto';
        mainImage.style.objectFit = 'contain';
        isZoomed = false;
    }
});

// 現在の画像を表示する関数を更新
function displayCurrentImage() {
    if (currentImages.length === 0) return;
    
    const imagePath = currentImages[currentIndex];
    
    // 画像読み込み前にクラスをリセット
    mainImage.classList.remove('zoomed', 'fitted');
    mainImage.style.maxWidth = '';
    mainImage.style.maxHeight = '';
    mainImage.style.width = '';
    mainImage.style.height = '';
    
    // 画像を設定
    mainImage.src = `file://${imagePath}`;
    
    // 画像読み込み完了後にフィット状態を設定
    mainImage.onload = () => {
        mainImage.classList.add('fitted');
        isZoomed = false;
        
        // フィット表示のスタイルを強制適用
        mainImage.style.maxWidth = 'calc(100% - 20px)';
        mainImage.style.maxHeight = 'calc(100% - 20px)';
        mainImage.style.width = 'auto';
        mainImage.style.height = 'auto';
        mainImage.style.objectFit = 'contain';
    };
    
    // カウンターを更新
    imageCounter.textContent = `${currentIndex + 1} / ${currentImages.length}`;
    
    // ナビゲーションボタンの状態を更新
    prevBtn.disabled = currentIndex === 0;
    nextBtn.disabled = currentIndex === currentImages.length - 1;
    
    // ファイル情報を更新
    updateFileInfo(imagePath);
}