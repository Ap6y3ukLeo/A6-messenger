#!/bin/bash

# Скрипт деплоя мессенджера на VPS (Ubuntu/Debian)
# Запускать от имени root или сsudo

set -e

echo "=== Начало деплоя мессенджера ==="

# Цвета для вывода
GREEN='\033[0;32m'
NC='\033[0m'

# Настройки (измените эти переменные)
DOMAIN="your-domain.com"  # Ваш домен или IP
PORT=3000
CLIENT_DIR="dist"

# Обновление системы
echo -e "${GREEN}1. Обновление системы...${NC}"
apt update && apt upgrade -y

# Установка Node.js
echo -e "${GREEN}2. Установка Node.js...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Установка Nginx
echo -e "${GREEN}3. Установка Nginx...${NC}"
apt install -y nginx

# Создание директории приложения
echo -e "${GREEN}4. Создание директории приложения...${NC}"
mkdir -p /var/www/messenger
cd /var/www/messenger

# Копирование файлов (нужно загрузить проект на сервер через git или scp)
echo -e "${GREEN}5. Установка зависимостей...${NC}"
npm install --production

# Сборка клиента
echo -e "${GREEN}6. Сборка клиента...${NC}"
cd client && npm install && npm run build

# Настройка Nginx
echo -e "${GREEN}7. Настройка Nginx...${NC}"
cat > /etc/nginx/sites-available/messenger << 'EOF'
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    # Клиент (статика)
    location / {
        root /var/www/messenger/client/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # Прокси API на Node.js сервер
    location /api/ {
        proxy_pass http://localhost:3000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Статика загруженных файлов
    location /uploads/ {
        alias /var/www/messenger/uploads/;
    }
}
EOF

# Активация сайта
ln -sf /etc/nginx/sites-available/messenger /etc/nginx/sites-enabled/
nginx -t

# Перезапуск Nginx
systemctl restart nginx

# Запуск Node.js сервера (через PM2 для автоперезапуска)
echo -e "${GREEN}8. Запуск Node.js сервера...${NC}"
npm install -g pm2
pm2 start server.js --name messenger
pm2 save
pm2 startup

# Настройка firewall
echo -e "${GREEN}9. Настройка firewall...${NC}"
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 22/tcp
ufw enable

echo -e "${GREEN}=== Деплой завершён! ===${NC}"
echo "Откройте http://$DOMAIN в браузере"