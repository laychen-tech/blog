import { setPasswordDirect } from '../src/auth.js';
import { config } from '../src/config.js';

const password = process.env.NEW_PASSWORD || process.argv[2];

if (!password) {
  console.error('用法：NEW_PASSWORD="新的管理密码（至少 10 位）" npm run reset-password');
  process.exit(1);
}

try {
  await setPasswordDirect(password);
  console.log(`[reset-password] 管理密码已更新：${config.authFile}`);
  console.log('[reset-password] 所有旧会话已失效，请使用新密码登录。');
} catch (error) {
  console.error(`[reset-password] ${error.message}`);
  process.exit(1);
}
