# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイダンスを提供します。

## 重要な指示

このリポジトリで作業する際は、**必ず日本語でレスポンスしてください**。ユーザーとのコミュニケーションは全て日本語で行うことが必要です。

## プロジェクト概要

UniPicは、重複画像の検出と削除を行うElectronベースのデスクトップアプリケーションです。バイナリハッシュ比較（MD5）とパーセプチュアルハッシュ（pHash）比較の両方を使用して、同一画像と視覚的に類似した画像を検出します。

## コマンド

**開発・実行**
- `npm start` - 本番モードでアプリケーションを実行
- `npm run dev` - 開発者ツールを有効にしてアプリケーションを実行  
- VS CodeでF5キー - 設定されたlaunch.jsonを使用してアプリを起動

**ビルド**
- `npm run build` - 現在のプラットフォーム向けにアプリをビルド
- `npm run build-mac` - macOS向けにアプリをビルド（DMG + ZIP）
- `npm run build-win` - Windows向けにアプリをビルド
- `npm run build-linux` - Linux向けにアプリをビルド

## アーキテクチャ

### コア構造

**メインプロセス (`main.js`)**
- ファイルシステム操作と画像処理を担当
- Sharpライブラリを使用した画像操作によるpHashアルゴリズムの実装
- レンダラープロセスとのIPC通信管理
- メインウィンドウと画像ビューアウィンドウの両方を作成
- メモリ効率のためのバッチ処理による画像ハッシュの並列処理

**メインウィンドウ (`index.html` + `renderer.js`)**
- フォルダ選択と重複表示のためのプライマリUI
- ドラッグ&ドロップによるフォルダ選択をサポート
- 類似度閾値スライダー（pHash距離の0-20範囲）を表示
- 「バイナリ同一」と「視覚的類似」を視覚的に区別して重複を表示
- ハッシュ計算と比較フェーズのリアルタイム進捗追跡

**画像ビューアウィンドウ (`image-viewer.html` + `image-viewer.js`)**
- 詳細な画像比較のための最大化されたセカンダリウィンドウ
- キーボードナビゲーション（矢印キー、A/Dキー、Delete、Space、F、Esc）をサポート
- メインウィンドウへの自動同期を伴うファイル削除機能
- 縦向き・横向き画像の両方を適切に処理するアスペクトフィット表示
- 詳細なファイル情報表示（サイズ、作成/更新日時、解像度）

### 主要技術コンポーネント

**重複検出アルゴリズム**
1. **バイナリハッシュ**: 完全重複のためのファイル内容のMD5ハッシュ
2. **パーセプチュアルハッシュ**: Sharpライブラリを使用した視覚的類似性のためのDCTベース63ビットハッシュ
3. **並列処理**: パフォーマンス向上のためのCPU数×2のバッチサイズとPromise.all
4. **ハミング距離**: pHash類似性の比較メトリック（設定可能な閾値）

**IPC通信**
- `select-folder` - フォルダ選択ダイアログ
- `scan-images` - 再帰的な画像ファイル検索
- `find-duplicates` - 進捗イベント付きのメイン重複検出
- `delete-file` / `delete-file-from-viewer` - ファイル削除操作
- `open-image-viewer` - 画像比較ウィンドウの起動
- 進捗イベント: `hash-progress`, `comparison-progress`, `file-deleted`

**画像処理**
- SharpによるWebP、AVIF、HEICを含む全主要フォーマットをサポート
- 未対応フォーマットのためのフォールバックハッシュ生成
- 32×32グレースケールリサイズ → 8×8 DCT → 63ビットハッシュ生成
- グレースフルデグラデーションによるエラーハンドリング

## 開発ノート

**VS Code統合**
- F5は開発者ツールなしでアプリを起動（本番環境類似）
- DevToolsによる開発には`npm run dev`を使用

**画像フォーマットサポート**
- プライマリ: JPEG、PNG、WebP、AVIF、TIFF、BMP、GIF、HEIC
- フォールバック: 未対応フォーマットのファイルメタデータを使用したSHA256ベースハッシュ

**UI状態管理**
- メインウィンドウがスキャン状態と重複結果を管理
- 画像ビューアは独立して動作するが、IPCを通じて削除を同期
- 進捗インジケータはファイルレベルと比較レベルの両方の進捗を表示

**パフォーマンス考慮事項**
- 大量画像コレクションでのメモリオーバーフローを防ぐバッチ処理
- メモリガベージコレクションのためのバッチ間50ms遅延
- 進捗更新の間引き（ハッシュ化では毎ファイル、検出では100回の比較毎）

**アプリアイコン設定**
- アプリアイコンは`icon/icon.png`を使用（512x512ピクセル推奨）
- nativeImage.createFromPath()でPNG形式のアイコンを読み込み
- macOSでは`app.dock.setIcon()`を使用してDockアイコンを設定
- メインウィンドウと画像ビューアウィンドウの両方にアイコンを設定
- ICNSファイルよりもPNGファイルの方が安定して動作

**Sharp依存関係の課題と解決**

Sharp（ネイティブ画像処理ライブラリ）をElectronアプリでビルドする際に遭遇した問題と解決方法：

*主な問題:*
- ビルド済みアプリで「Could not load the "sharp" module using the darwin-arm64 runtime」エラー
- libvips-cpp.42.dylibが見つからないエラー
- Sharpのネイティブバイナリがアプリパッケージに正しく含まれない

*試行した解決方法:*
1. **asarUnpack設定**: `node_modules/sharp/**/*`をasar外に配置
2. **electron-builder install-app-deps**: 依存関係の自動処理
3. **@electron/rebuild**: 最新の推奨ツールに移行
4. **ビルド前の強制再ビルド**: `npm run rebuild`でSharpを毎回再構築

*最終的な解決方法:*
```json
{
  "scripts": {
    "rebuild": "electron-rebuild -f -w sharp",
    "build-mac": "npm run rebuild && electron-builder --mac"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.7.2"
  },
  "build": {
    "asarUnpack": [
      "node_modules/sharp/**/*",
      "node_modules/@img/**/*"
    ]
  }
}
```

*重要なポイント:*
- ビルド前に必ず`electron-rebuild -f -w sharp`を実行
- asarUnpackでSharp関連モジュールを全て除外
- @electron/rebuildが推奨（electron-rebuildは非推奨）
- JimpからSharpに移行する場合は、Sharpの方が高速だがビルド設定が複雑

**ビルド設定**
- electron-builderを使用してクロスプラットフォームビルドを実行
- ビルド出力は`dist/`フォルダに生成される
- macOSビルド出力：
  - `UniPic-1.0.0-arm64.dmg` - インストーラー（DMG形式）
  - `UniPic-1.0.0-arm64-mac.zip` - ZIP形式の配布パッケージ
  - `mac-arm64/UniPic.app` - macOSアプリケーション本体
- コード署名は開発者証明書が設定されている場合に自動実行される
- macOSのnotarization（公証）は手動で設定する必要がある