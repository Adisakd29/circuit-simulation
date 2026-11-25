# Circuit Lab 3D — เว็บ + บริการคอมไพล์ Arduino (avr-gcc) + บริการจำลอง ESP32 (QEMU) ในบริการเดียว
# สเตจ 1: สร้างหน้าเว็บ (dist/) + ตัวจำลองวงจรสำหรับเซิร์ฟเวอร์ (server/engine/)
FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm run build:engine

# สเตจ ESP32: QEMU (lcgamboa/qemu สาขา picsimlab-esp32, GPL-2.0) เป็น libqemu-xtensa.so + esp32-bridge (GPL-2.0-or-later)
# + เฟิร์มแวร์ MicroPython v1.24.1 ESP32_GENERIC ทางการ (MIT) ทำเป็นอิมเมจแฟลช 4 MB · ROM ของ ESP32 จาก Espressif (Apache-2.0)
FROM ubuntu:24.04 AS esp32
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl gcc libc6-dev ninja-build python3 python3-venv pkg-config \
    libglib2.0-dev libpixman-1-dev libgcrypt20-dev libslirp-dev flex bison perl && rm -rf /var/lib/apt/lists/*
COPY server/esp32 /src/esp32
RUN sh /src/esp32/build-qemu.sh /work /opt/esp32 && rm -rf /work
RUN curl -fsSL -o /tmp/mp.bin https://micropython.org/resources/firmware/ESP32_GENERIC-20241129-v1.24.1.bin \
 && echo "21d61b5241b2e00f9a774a797079fc287b66beb071dfaf4b6b340bf84d15f048  /tmp/mp.bin" | sha256sum -c - \
 && python3 -c "d=open('/tmp/mp.bin','rb').read(); assert d[0]==0xe9 and d[2]==2; img=bytearray(b'\\xff'*4194304); img[0x1000:0x1000+len(d)]=d; open('/opt/esp32/flash-mp.bin','wb').write(img)" \
 && rm /tmp/mp.bin

# สเตจ 2: เซิร์ฟเวอร์ Node (ไม่มี dependency) + avr-gcc 7.3 + ArduinoCore-avr 1.8.6 (LGPL-2.1) + Servo 1.2.2 + LiquidCrystal 1.0.7 (LGPL-2.1)
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc-avr avr-libc binutils-avr git ca-certificates libglib2.0-0t64 libpixman-1-0 libgcrypt20 libslirp0 \
 && git clone --depth 1 --branch 1.8.6 https://github.com/arduino/ArduinoCore-avr.git /opt/arduino/ArduinoCore-avr \
 && git clone --depth 1 --branch 1.2.2 https://github.com/arduino-libraries/Servo.git /opt/arduino/Servo \
 && git clone --depth 1 --branch 1.0.7 https://github.com/arduino-libraries/LiquidCrystal.git /opt/arduino/LiquidCrystal \
 && rm -rf /opt/arduino/*/.git \
 && apt-get purge -y git && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY --from=web /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY server ./server
COPY --from=web /app/dist ./dist
COPY --from=web /app/server/engine ./server/engine
COPY --from=esp32 /opt/esp32 /opt/esp32
ENV NODE_ENV=production \
    ARDUINO_CORE_DIR=/opt/arduino/ArduinoCore-avr \
    ARDUINO_SERVO_DIR=/opt/arduino/Servo \
    ARDUINO_LCD_DIR=/opt/arduino/LiquidCrystal \
    ARDUINO_CACHE_DIR=/opt/arduino/cache \
    STATIC_DIR=/app/dist \
    ESP32_BRIDGE=/opt/esp32/esp32-bridge \
    ESP32_QEMU_LIB=/opt/esp32/libqemu-xtensa.so \
    ESP32_QEMU_BIOS=/opt/esp32/pc-bios \
    ESP32_FLASH=/opt/esp32/flash-mp.bin \
    ESP32_MAX_SESSIONS=2
# คอมไพล์ core.a และไลบรารีไว้ล่วงหน้า — คำขอแรกจึงไม่ช้า
RUN node server/compile.mjs --prebuild
RUN useradd -m app && chown -R app /opt/arduino/cache
USER app
EXPOSE 8080
CMD ["node", "server/server.mjs"]
