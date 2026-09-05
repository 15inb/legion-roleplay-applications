const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'legion-roleplay-applications',
      script: 'src/index.js',
      cwd: path.resolve(__dirname),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      restart_delay: 5000,
      max_memory_restart: '300M',
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
