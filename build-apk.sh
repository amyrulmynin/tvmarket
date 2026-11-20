#!/bin/bash
# Bina APK TVMarket — pipeline tanpa Gradle (aapt2 → javac → d8 → zip → align → sign)
set -e
cd /home/ubuntu/.hermes/cache/scratch/tv
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
BT=$PWD/sdk/build-tools/34.0.0
PLAT=$PWD/sdk/platforms/android-34/android.jar

rm -rf build && mkdir -p build/gen build/obj build/apk

$BT/aapt2 compile --dir app/src/main/res -o build/res.zip
$BT/aapt2 link -o build/base.apk -I $PLAT --manifest app/src/main/AndroidManifest.xml \
  -R build/res.zip -A app/src/main/assets --java build/gen --auto-add-overlay

find build/gen app/src/main/java -name "*.java" > sources.txt
javac -source 8 -target 8 -bootclasspath $PLAT -d build/obj @sources.txt 2>&1 | grep -vi "deprecat\|warning" || true
echo "classes: $(find build/obj -name '*.class' | wc -l)"

$BT/d8 --lib $PLAT --min-api 24 --output build/apk $(find build/obj -name '*.class')

python3 - <<'PY'
import zipfile
src = zipfile.ZipFile('build/base.apk')
out = zipfile.ZipFile('build/apk/final-unsigned.apk', 'w', zipfile.ZIP_DEFLATED)
for item in src.infolist():
    out.writestr(item, src.read(item.filename))
out.write('build/apk/classes.dex', 'classes.dex')
out.close()
print('packed:', len(src.infolist()) + 1, 'entries')
PY

$BT/zipalign -f -p 4 build/apk/final-unsigned.apk build/apk/aligned.apk
$BT/apksigner sign --ks debug.keystore --ks-pass pass:android --key-pass pass:android \
  --min-sdk-version 24 --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out TVMarket.apk build/apk/aligned.apk
$BT/apksigner verify TVMarket.apk && echo "VERIFY OK"
cp TVMarket.apk /home/ubuntu/TVMarket.apk
ls -lh /home/ubuntu/TVMarket.apk
sha256sum /home/ubuntu/TVMarket.apk
