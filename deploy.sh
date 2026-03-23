#!/bin/bash

# Скрипт деплоя мессенджера на VPS (Ubuntu/Debian)
# Запускать от имени root или sudo

set -e

echo "=== Начало деплоя мессенджера ==="

# Цвета для вывода
GREEN='\033[0;32m'
NC='\033[0m'

# Настройки (измените эти переменные)
DOMAIN="your-domain.com"  # Ваш домен или IP
PORT=3000

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
uploads
cd /var/www/messenger

# Клонирование репозитория
git clone https://github.com/Ap6y3ukLeo/A6-messenger.git .

# Установка зависимостей
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
    server_name _;

    root /var/www/messenger/client/dist;
    index index.html;

    # Статика
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API прокси
    location /api/ {
        proxy_pass http://localhost:3000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Загрузки
    location /uploads/ {
        alias /var/www/messenger/uploads/;
    }
}
EOF

# Удаление default сайта и активация
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/messenger /etc/nginx/sites-enabled/
nginx -t

# Перезапуск Nginx
systemctl reload nginx

# Запуск Node.js сервера (через PM2)
echo -e "${GREEN}8. Запуск Node.js сервера...${NC}"
npm install -g pm2
pm2 start server.js --name messenger
pm2 save

echo -e "${GREEN}=== Деплой завершён! ===${NC}"
echo "Откройте http://$DOMAIN в браузере"