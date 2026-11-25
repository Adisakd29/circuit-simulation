import subprocess, time, resource, sys, re
shift = sys.argv[1]; dur = float(sys.argv[2])
args = ['qemu-src/build/qemu-system-xtensa', '-M', 'esp32-picsimlab', '-nographic', '-L', 'qemu-src/pc-bios', '-drive', 'file=flash.bin,if=mtd,format=raw', '-serial', f'file:out{shift}.txt', '-monitor', 'none']
if shift != '0': args += ['-icount', f'shift={shift},sleep=off']
t0 = time.time(); p = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
# boot time: first 'boot' line
boot = None
while time.time() - t0 < dur:
    time.sleep(0.05)
    if boot is None:
        try:
            if 'boot' in open(f'out{shift}.txt', errors='ignore').read(): boot = time.time() - t0
        except FileNotFoundError: pass
p.terminate(); p.wait()
ru = resource.getrusage(resource.RUSAGE_CHILDREN)
txt = open(f'out{shift}.txt', errors='ignore').read()
ts = [int(m) for m in re.findall(r't=(\d+)', txt)]
print(f'shift={shift} wall={dur}s cpu={ru.ru_utime+ru.ru_stime:.2f}s maxrss={ru.ru_maxrss/1024:.0f}MB boot_wall={boot and round(boot,2)}s lines={len(ts)} sim_t_last={ts[-1]/1e6 if ts else None}s')
if len(ts) > 3: d=[(ts[i]-ts[i-1])/1000 for i in range(1,len(ts))]; print('  loop period ms: min %.2f max %.2f' % (min(d[1:]), max(d[1:])))
