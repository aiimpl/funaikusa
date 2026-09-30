# Funaikusa（船戦）— sea battle in the Seto Inland Sea, 1580s

A browser game of the late Sengoku period: fleets of rowed warships (atake-bune, seki-bune and kobaya) fight with great guns, muskets, fire pots and boarding in the tidal channel by Noshima, the sea castle of the Murakami pirates.
It runs on three.js. No photos, videos, hand-painted textures or ready-made 3D models: the ships, the guns and the castle were built plank by plank by Python scripts driving Blender, the islands are eroded heightfields, and the sea, sky, haze, smoke, fire, wake and sound are computed at runtime.
The interface is in English by default; the button at the top right (or `?lang=ja`) switches to Japanese.

**Play: https://aiimpl.github.io/funaikusa/**

---

# 船戦 — 戦国末・瀬戸内の水軍

戦国時代の終わり（1570〜90年代）の瀬戸内で、安宅船・関船・小早の船団が、大筒・鉄砲・焙烙火矢・乗り込みで戦うブラウザのゲームです。
舞台は村上水軍（能島村上）の本拠地、能島のまわりの潮の速い瀬戸です。
three.js で動きます。写真・動画・手描きのテクスチャ・既製の3Dモデルは使っていません。
船・大筒・城は Python で Blender を動かして板1枚ずつ組み、木目・風化・陰を焼き付けました。島は数値の浸食で削った地形です。海・空・霞・煙・火・航跡・音は実行時の計算です。

> 船・大筒・城は、史料と復元模型・発掘の記録（`ref/` にまとめた出典）をもとにした作図です。島の並びは能島・鵜島・伯方島・大島の実際の配置に合わせましたが、海岸線は生成したもので、戦いは架空です。実在の人物は出てきません。

## 遊び方
二つの戦いから選びます。

| 戦い | 自分の側 | 勝ち方 |
|---|---|---|
| 焙烙の瀬戸 | 能島方：関船1艘と小早の群れ | 潮に乗って寄せ、焙烙で焼き、乗り込む |
| 大筒の沖 | 寄せ手：船首に大筒3門の安宅船 | 小早の群れを寄せつけず、遠くから大筒で崩す |

敵の旗船を沈めるか奪うか、敵の船団の3分の2を戦えなくすれば勝ちです。自分の船を失うか、味方の3分の2が戦えなくなれば負けです。

| キー | 内容 |
|---|---|
| A / D | 舵 |
| W / S | 櫓の拍子（止め・並・急ぎ・総がかり）。総がかりを続けると漕ぎ手が疲れる |
| F | 船首の大筒を撃つ（込め済みのものから） |
| R / V | 大筒の仰角。海面に落ちる所を点線で示す |
| G | 熊手を掛けて乗り込む（横付けしているとき） |
| 1〜4 | 味方への下知：旗船に続け／散れ／囲め／退け |
| M | 帆柱を立てる・倒す |
| C | 視点（船の後ろ・大筒の照準・戦場の遠望） |
| ドラッグ・ホイール | 視点を回す・寄る |

鉄砲と焙烙は乗り手が自分で撃ち、投げます。時刻は実時間1秒でゲーム内6秒進みます。URL に `?t=7`（開始時刻）、`?wind=6`（風速 m/s）、`?ts=20`（時間の速さ）を付けて変えられます。

## できるもの
- **船**：安宅船（全長約30m、櫓76挺、総矢倉2段と2層の楼閣、戸立造りの箱型の船首）、関船（約20m、櫓44挺、丸い鉄砲狭間）、小早（約11m、櫓16挺、半垣造り）。盾板の狭間、倒れる帆柱、櫓床と船梁の頭、筵帆。能島方は素木、寄せ手は黒塗り
- **櫓**：和船の櫓は漕ぐのではなく「こぐ」（水の中で羽根を振る）。羽根は水に入ったまま、柄を振り、ねじる
- **大筒**：1貫目玉（86mm）の鍛鉄の大筒を船首に。発砲の閃光、反動で砲身が下がって戻る、白い硝煙。石火矢（後装の仏郎機砲）の部品も作ってある
- **弾道**：重力と空気抵抗（速さの2乗）。撃つ瞬間の船の揺れが弾の向きに入る。当たった所の高さで、穴があく（水線の下は浸水）・盾板の裏の人が倒れる・櫓が折れる
- **火**：焙烙で燃え上がり、隣の区画へ広がる。乗り手が消しにかかると撃つ手が減る。焦げた板、火の粉、風に傾く黒煙
- **沈没**：浸水した区画の水の重さを浮力の計算に入れるので、穴のあいた側へ傾いて沈む（沈み方は作り込んでいない）
- **乗り込み**：横付けして熊手を掛け、武者の数と士気で決着。負けた側の船を奪う
- **船の頭脳**：自分の船と同じ操作（舵と櫓の拍子）で動く。安宅船は距離をとって船首を向け、小早は寄って焼き、乗り込む
- **煙**：霞と同じ前方散乱の式で光る。逆光では白く輝き、順光では灰色に沈む
- **潮**：能島のまわりで最大約8ノット。潮に逆らうと漕ぎ手がすぐ疲れる
- **能島の城**：3段に削った曲輪、柵、掘立柱の建物、礎石の倉、物見櫓、北の浜の船着き場と岩礁の柱（発掘の記録をもとにした作図）
- **音**：大筒の轟き（距離÷343m/s 遅れて届き、遠いほどこもる）、鉄砲、着弾、陣太鼓（櫓の拍子に合わせる）、法螺貝、火の音（すべて WebAudio の合成）

## 動作環境
- 遊ぶだけ：WebGL2 が動くブラウザ（Chrome / Safari / Edge）。Apple M 系の Mac で動きます。重いときは描画解像度が自動で下がります
- 焼き直し：Blender 5.x、Python 3.10+、cwebp

## 使い方
```sh
make serve       # http://127.0.0.1:8795/ で開く
make setup       # 焼き直しと確認用の Python 環境（numpy・scipy・Playwright）
make bake        # 船3種・大筒・城・島を焼き直す（船は1種 10〜30分）
make preview     # 船と大筒を Cycles で数方向から描いて確かめる
make check       # Python 側の文法確認（pyflakes）
```

## しくみ
- **船の組み立て**（`bake/wargeo.py`・`warparts.py`）：船体は潮待ちの弁才船と同じ和船の造り（航と3段の棚、竜骨なし）。4本の縁の曲線を種類ごとの長さ・幅・深さ・喫水に伸ばし、安宅船は艫の戸立を船首にも付けて箱型にする。総矢倉・盾板・狭間（穴の形まで）・楼閣を部品として組む
- **焼き付け**（`bake/bakelib.py`・`warship.py`）：木目・日焼け・雨筋・水線の苔・タールをノードで作り、色・粗さ・AO を 4096² に焼く。黒塗りの色だけもう一枚焼く。遠くで使う簡略形も2段作る
- **物理**（`web/src/hull.js`）：船底を柱に分け、水面より下の体積で浮力。櫓の推力は漕ぎ手の力（F = P / v）で決まる。浸水は区画ごとにトリチェリの式で流れ込み、その重さが浮力と釣り合わなくなると沈む
- **弾道と被害**（`web/src/gunnery.js`・`fleet.js`）：弾の通り道を船の箱と船自身の座標で交差させる。被害・火事・乗り込み・士気・船の頭脳は fleet.js
- **描画**（`web/src/warship.js`・`crew.js`）：船・櫓・乗り手・旗はすべてインスタンス描画。60隻でも描く回数は数十
- **煙と火**（`web/src/fx.js`）：CPU で動かす粒子。煙は霞と同じ Henyey–Greenstein の散乱と、玉の中を通る光の減り方で光らせる
- **海・空・島・潮**：潮待ち（`aiimpl/shiomachi`）のものを移して、複数の船の航跡・着弾の波紋・速い潮を足した

## 構成
```
bake/
  wargeo.py       船体の線図（3種類）
  warparts.py     船の部品（外板・総矢倉・盾板と狭間・楼閣・櫓・舵・帆柱）
  warship.py      材質・確認用の描画・焼き付けと書き出し（3種類）
  guns.py         大筒・石火矢・焙烙
  castle.py       能島の城と、城の島の細かい地面
  islands.py      島と遠景の高さ（numpy）。能島と鯛崎島の形もここ
  bakelib.py      材質・焼き付け・書き出しの共通部分
  meshb.py        部品を集めて Blender のメッシュにする（UV つき）
  terrainlib.py   ノイズと浸食
  blib.py         Blender の小道具
web/
  index.html      ページと画面表示
  src/main.js     起動と1コマの流れ
  src/hull.js     船の物理            src/fleet.js    被害・火・乗り込み・船の頭脳
  src/gunnery.js  弾道と命中          src/fx.js       煙・火・水柱
  src/warship.js  船の描画            src/crew.js     乗り手・旗
  src/castle.js   能島の城            src/scenario.js 二つの戦い
  src/ocean.js    海面                src/waves.js    波
  src/wake.js     航跡                src/tide.js     潮
  src/wind.js     風の帯              src/sky.js      空・霞・太陽の位置
  src/islands.js  島                  src/trees.js    松
  src/audio.js    音                  src/hud.js      画面の表示
  src/i18n.js     画面の言葉（英語・日本語）  src/film.js    映像の台本
  data/           焼いたデータ（glb・webp・高さ）
ref/              資料（寸法・構造・火器・能島の出典つきのまとめ）
tools/probe.py    Chrome で開いて操作し、状態と画面を記録する（window.__fast で戦いを早回し）
tools/render.py   映像を1コマずつ書き出す（make video で音と mp4 まで）
```

## ライセンス
MIT（`LICENSE`）。three.js は `web/vendor/three/LICENSE` のとおり MIT です。
