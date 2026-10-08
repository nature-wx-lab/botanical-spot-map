# 植物めぐりMAP / Botanical Spot Map

全国の植物を「見る・買う・学ぶ・体験する・収穫する」場所を探す地図です。

公開先：<https://nature-wx-lab.github.io/botanical-spot-map/>

## 初回の範囲

2026年10月8日版は、地理院タイルによる地図、全国表示、47都道府県、21ジャンル、植物・目的・屋内外の絞り込み、植物未選択で使える「いま見頃あり」、施設一覧のUIを備えます。**施設登録は0件で、実際の施設検索・見頃案内に使うためのデータはこれから整備します。** 架空施設や未確認の開花状況を本番へ混ぜません。

実況は植物と園内エリアの対象単位で管理します。植物・場所・目的・現在の見頃が同じ対象上で一致した施設だけを結果に出します。一般の咲き始め、例年の時期、過去予想を見頃へ変換しません。温室の開花は公式等の根拠と観覧可能性を確認し、注目の開花として分けます。有効期限を画面でも毎分・ページ復帰時に再評価します。

施設の営業時間と植物の状態は別情報です。現在の在庫や営業中という推測はしません。実況、予想、例年、イベントはデータ上も分離し、初回の予想・例年・イベント配列は空に限定します。

## 次に増やすもの

1. 公式情報・一般利用条件・所在地・座標の出所を確認した実在施設。北海道から沖縄・離島まで、植物園だけでなく専門店・直売所・体験施設も対象です。
2. 根拠と情報日・有効期限・園内の場所を持つ実況。観察日を取得日へ書き換えず、取消し・観覧終了を反映します。
3. 指定日の公表予想、見頃入り予想、例年の複数期間、会場と分けた期間限定イベント。
4. 情報源の利用条件を確認した差分更新。全施設の毎日再検索・無制限のAI処理は前提にしません。初回は自動収集・定期更新を設定していません。

独自予測、写真、現在地、一般投稿、会員・通知・広告は未実装です。名称のWeb完全一致検索で同名結果は見つかりませんでしたが、商標調査の完了を意味しません。

## 更新方法

画面は `site/`、公開データは `site/data/catalog.json`、検索と検査は `site/engine.mjs` が所有します。ビルド用の依存インストールは不要です。`main` へのpush時、下記の検査を通った配信許可リストだけをGitHub Pagesへデプロイします。

```sh
node --check site/app.mjs
node --test tests/search.test.mjs
python3 scripts/check_release.py
```

公開commitの名前は `nature-wx-lab`、メールは `289840956+nature-wx-lab@users.noreply.github.com` に限定します。GitHub Actionsを使ってcommitを作る場合の名義も、検査の固定許可リストに限定します。公開後の修正は同じURLへ検査済みの更新として反映します。

## データ追加の契約

`validateCatalog` が必須項目・参照・目的の整合・座標範囲・日時・URLを検査します。施設は公開来訪先だけを掲載し、座標に出所・確認日・入口または敷地代表点の区分を持たせます。名前だけの重複統合、位置の推測、Googleマップからの台帳抽出は行いません。

施設の `sources` は項目の事実を独自に確認した根拠URL・確認日・利用根拠を記録します。引用文・写真・ロゴ・元ページの複製は初期データへ含めません。非公開の個人宅、私的連絡先、希少植物の精密な自生位置は掲載しません。施設に複数の植物があっても施設件数は重複させません。

公開データの追加には、コード試験だけでなく、実在・座標・情報日・利用条件の個別確認が必要です。データの形式検査は、出所の事実精度や権利の実質的確認を代行しません。未対応の予想・例年・イベントが入力された場合は公開を止めます。

## 公開安全と通信

新規repositoryの履歴から始め、非公開の制作ワークスペース・元の引き継ぎ資料・ローカル履歴を持ち込みません。本文、ファイル名、全reachable履歴、コミットメッセージとauthor/committerを検査します。配信するのは `scripts/check_release.py` の固定許可リストだけです。管理機能、外部URLを取得するAPI、認証情報を持つバックエンドはありません。

検索語の外部送信、現在地取得、解析タグ、Cookieやブラウザ保存領域への検索記録は行いません。GitHubのホスティングと背景地図の読み込みに通常のWeb通信が発生します。地図配信元にはIPアドレスや表示領域のタイル番号が伝わります。背景地図の通信を停止できるボタンを用意します。

HTMLのCSPでスクリプトは同じ配信元に限定し、外部画像は地理院タイルだけを許可します。地図ライブラリの位置計算のため、スタイルのinline指定は必要です。外部情報は `textContent` とDOM要素として扱い、URLはHTTPSだけを許可します。外部リンクは `noopener noreferrer` を付けます。GitHub Pagesでは任意のHTTPヘッダーを設定できないため、ヘッダーにしか指定できない保護はこの版の実装済み機能とは扱いません。

掲載情報の訂正・不具合は [GitHub Issues](https://github.com/nature-wx-lab/botanical-spot-map/issues) で受け付けます。投稿は公開されるため、私的な連絡先・所在地・認証情報は書かないでください。施設へのメールやSNS送信を自動化しません。

## 地図・ライブラリ

- 背景：国土地理院の [淡色地図](https://maps.gsi.go.jp/development/ichiran.html)、ズーム3〜17、`https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png` をリアルタイム読み込み。画像自体の改変・キャッシュ再配布はせず、ピンを別レイヤーに重ねます。
- [地理院タイルの利用案内](https://maps.gsi.go.jp/development/ichiran.html) と [現行コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html) を2026年10月8日に確認。出典リンクと、低倍率で必要なVMAP0の出所を画面内に明記します。
- [Leaflet 1.9.4](https://leafletjs.com/download.html) は公式GitHubの [同版release ZIP](https://github.com/Leaflet/Leaflet/releases/download/v1.9.4/leaflet.zip) と同版のLICENSEから取得し、BSD-2-Clauseの表示を `site/vendor/LICENSE` に保持します。配布元の改行を含む元のbytesを保持します。実行時の外部CDNは使いません。採用ファイルのハッシュは `scripts/vendor_hashes.json` で固定します。

Shoreline data is derived from: United States. National Imagery and Mapping Agency. "Vector Map Level 0 (VMAP0)." Bethesda, MD: Denver, CO: The Agency; USGS Information Services, 1997.
