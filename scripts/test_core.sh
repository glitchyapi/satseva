#!/bin/bash
set -e
cd "$(dirname "$0")/.."
export JAVA_HOME=${JAVA_HOME:-/opt/jdk}; export PATH="$JAVA_HOME/bin:$PATH"
AJ=${ANDROID_HOME:-/opt/android}/platforms/android-34/android.jar
mkdir -p build/testclasses
javac -encoding UTF-8 -nowarn -cp "$AJ:tests/lib/json.jar" -d build/testclasses \
  app/src/main/java/org/satseva/app/Codec.java \
  app/src/main/java/org/satseva/app/Http.java \
  app/src/main/java/org/satseva/app/ReleaseProtocol.java \
  tests/CoreTests.java
java -cp "build/testclasses:tests/lib/json.jar:$AJ" satseva.test.CoreTests .
