# 植物めぐりMAP / Botanical Spot Map

全国の植物を「見る・買う・学ぶ・体験する・収穫する」場所を探す地図です。

公開先：<https://nature-wx-lab.github.io/botanical-spot-map/>

## 全国版の範囲

47都道府県の植物園、園芸店、花店、自然観察スポットなどを検索できます。全施設を検索対象にし、目的・地域・ジャンル・植物の条件を重ねて絞ります。複数の検索語は空白で区切るAND検索です。

広域の地図では近接する施設を件数付きでまとめ、拡大に合わせてジャンル別アイコン・名前・紹介を表示します。施設一覧は30件ずつ、詳細は開いたときだけ生成します。件数を減らして軽く見せるのではなく、全候補を保持して描画量を制限しています。

### 施設情報の区別

- `site/data/catalog.json`: 公式情報を個別確認した21施設、植物・例年の見頃・期間限定イベント。従来の確認日・公式リンクを保持します。
- `site/data/nationwide.json`: Overture Maps Placesの公開データから選別した施設。個別の公式確認済みとは表示しません。施設の存在信頼度は、現在営業中・来訪可能・正しい分類という保証ではありません。

全国収録分は植物・在庫・屋内外・見頃・来訪可否が未確認です。未確認項目を検索条件に一致させたり、季節の目安を現在の開花へ変換したりしません。「公式情報を確認した施設だけ」で個別確認分に絞れます。期間限定イベントは開始・終了・取消しで表示対象を再評価します。

網羅的な施設名簿やおすすめランキングではありません。花店などに偏りがあり、休廃業や誤分類・位置ずれが残る場合があります。写真、現在地、一般投稿、会員機能はありません。

## データと更新方法

Placesの出典・原ライセンス・行政界照合・変更内容は公開の `site/data/NOTICE.txt` が所有します。元データのメール、電話、SNS、住所番地を公開ファイルへ持ち込みません。HTTPのみのサイトや認証情報付きURLも公開しません。

収録元はOverture Maps Places `2026-09-23.1`。STACの配布範囲から日本を含むファイルだけを選び、日本の位置・国コード・分類・名称で候補を限定します。存在信頼度0.7以上を必要条件とし、植物関連性・一般店や付属施設の除外・都道府県と位置の矛盾・名称と近接位置の重複を別に検査します。花・ギフト分類だけを花店と見なすことはしません。

都道府県は固定版のgeoBoundaries JPN ADM1と位置を照合し、元住所に都道府県があれば矛盾を除外します。位置が行政界に含まれず住所にも都道府県がなければ不採用です。位置や市区町村を想像で補いません。施設名・所在自治体・座標・原分類・出典IDなど、明示した項目だけを出力します。

登録上限は個別確認分を含む10,000件、候補上限は30,000件です。地域・分類ごとに存在信頼度の高い候補から順番に採用します。収録元が更新されても自動公開はしません。取得候補は一時置き場で扱い、公開するのは選別後の派生データだけです。

手動更新にはPython、DuckDB 1.5.6、Shapely 2を使用します。ブラウザの実行時依存は同梱Leafletのみです。候補と行政界ファイルを準備してから実行します。

```sh
python3 scripts/import_places.py --fetch --candidates .build/candidates.json --boundaries .build/prefectures.geojson
node --check site/app.mjs
node --check site/engine.mjs
node --test tests/search.test.mjs
python3 scripts/check_release.py --stage
```

行政界の固定URLとSHA-256は `scripts/import_places.py` の `BOUNDARY_URL` / `BOUNDARY_SHA` に固定。候補取得・変換に失敗した場合、公開中データは変更しません。スクリプトはローカル候補を再利用できます。スコアを下げて件数を満たす操作はせず、条件で不足すれば更新を止めます。

公開前には形式・件数・47都道府県・参照・ライセンスと全履歴のプライバシー検査に加え、ローカルと公開画面で検索、ページ送り、地図拡大、詳細、PC・スマートフォン表示を確認します。形式検査だけで個別事実の正確さを保証しません。

`main`へのpushで固定された配信許可リストだけをGitHub Pagesへデプロイします。公開commit名義は `nature-wx-lab <289840956+nature-wx-lab@users.noreply.github.com>`。公開後は配信ファイルの内容とデプロイcommitを照合します。情報収集の定期実行は設定していません。

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
