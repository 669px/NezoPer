module.exports = {
  apps: [
    {
      name: "numan-wa-bot",
      script: "./main.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
}
