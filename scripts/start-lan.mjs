import os from 'node:os';
import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';

function getLanIp() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    if (/vEthernet|Virtual|WSL|Loopback|docker|Pseudo/i.test(name)) continue;
    for (const net of addrs) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        candidates.push({ name, address: net.address });
      }
    }
  }
  // Ưu tiên WiFi hoặc Ethernet
  const primary = candidates.find(c => /wi-?fi|ethernet|en0|eth0|wlan/i.test(c.name)) || candidates[0];
  return primary ? primary.address : '127.0.0.1';
}

async function main() {
  const ip = getLanIp();
  const rootDir = resolve(import.meta.dirname, '..');

  let choice = process.argv[2];

  if (!choice) {
    console.clear();
    console.log('\x1b[36m================================================================\x1b[0m');
    console.log('\x1b[1m\x1b[36m             PHÒNG HỌC TOEIC 3D - KHỞI ĐỘNG MẠNG LAN            \x1b[0m');
    console.log('\x1b[36m================================================================\x1b[0m');
    console.log(`  IP WiFi / LAN hiện tại (DHCP): \x1b[33m\x1b[1m${ip}\x1b[0m\n`);
    console.log('  \x1b[32m\x1b[1m[1] Chạy trực tiếp (Dev HTTPS) - KHUYÊN DÙNG CHO MÁY DHCP\x1b[0m');
    console.log('      • Tự động nhận diện mọi IP khi router đổi IP (không lo mất mạng)');
    console.log('      • Không cần Docker / Rancher Desktop, không tốn RAM');
    console.log('      • Không cần quyền Administrator, không cần cấu hình portproxy');
    console.log(`      • Thiết bị cùng WiFi truy cập: \x1b[32mhttps://${ip}:5173\x1b[0m\n`);
    console.log('  \x1b[33m\x1b[1m[2] Chạy qua Docker (Rancher Desktop)\x1b[0m');
    console.log('      • Chạy nền dạng container (Production build)');
    console.log('      • Tự động tạo cert SSL & đồng bộ portproxy Windows cho IP mới');
    console.log(`      • Thiết bị cùng WiFi truy cập: \x1b[33mhttps://${ip}:3443\x1b[0m\n`);
    console.log('  \x1b[90m[0] Thoát\x1b[0m');
    console.log('\x1b[36m================================================================\x1b[0m');

    const rl = readline.createInterface({ input: stdin, output: stdout });
    const answer = await rl.question('Nhập lựa chọn của bạn [1 hoặc 2] (Mặc định: 1): ');
    rl.close();

    choice = answer.trim() || '1';
  }

  if (choice === '0') {
    console.log('Đã thoát.');
    process.exit(0);
  }

  if (choice === '1' || choice.toLowerCase() === 'dev') {
    console.log(`\n\x1b[32m>>> Đang khởi động chế độ Dev HTTPS trực tiếp...\x1b[0m`);
    console.log(`\x1b[36m>>> Thiết bị khác cùng WiFi truy cập: https://${ip}:5173\x1b[0m\n`);

    const child = spawn('npm', ['run', 'dev'], {
      cwd: rootDir,
      stdio: 'inherit',
      env: { ...process.env, HTTPS: '1' },
      shell: true,
    });

    child.on('exit', (code) => process.exit(code ?? 0));
  } else if (choice === '2' || choice.toLowerCase() === 'docker') {
    console.log(`\n\x1b[33m>>> Đang cấu hình và khởi động Docker LAN...\x1b[0m`);

    if (process.platform === 'win32') {
      const child = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', resolve(rootDir, 'scripts/setup-docker-lan.ps1'),
        ip
      ], {
        cwd: rootDir,
        stdio: 'inherit',
      });
      child.on('exit', (code) => process.exit(code ?? 0));
    } else {
      // macOS / Linux
      const certChild = spawn('bash', [resolve(rootDir, 'scripts/make-cert.sh'), ip], {
        cwd: rootDir,
        stdio: 'inherit',
      });
      certChild.on('exit', () => {
        const dockerChild = spawn('docker', ['compose', 'up', '-d'], {
          cwd: rootDir,
          stdio: 'inherit',
        });
        dockerChild.on('exit', (code) => {
          console.log(`\n\x1b[32mDocker đã sẵn sàng: https://${ip}:3443\x1b[0m`);
          process.exit(code ?? 0);
        });
      });
    }
  } else {
    console.log('\x1b[31mLựa chọn không hợp lệ.\x1b[0m');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
