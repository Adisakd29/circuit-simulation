cd /tmp/claude-0/esp/qemu-src
flags="$(./configure --help | perl -ne 'print if s/^  ([a-z][\w-]*) .*/\1/' | tail -n +2 | awk '{print "--disable-"$1}' ORS=' ')"
./configure --target-list=xtensa-softmmu --extra-cflags=-fPIC $flags --enable-tcg --enable-system --disable-werror --enable-gcrypt --enable-slirp > /tmp/claude-0/esp/configure.log 2>&1 || { echo CONFIGFAIL > /tmp/claude-0/esp/build.done; exit 1; }
cd build && (time ninja -j2) > /tmp/claude-0/esp/ninja.log 2>&1
echo "ninja=$?" > /tmp/claude-0/esp/build.done
