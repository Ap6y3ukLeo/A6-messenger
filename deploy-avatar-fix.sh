#!/bin/bash
# Скрипт для обновления VPS с поддержкой загрузки аватарок

echo "=== Обновление messenger на VPS ==="

# Обновление кода
cd /var/www/messenger
git pull origin master

# Пересборка клиента
cd client
npm run build
cd ..

# Перезапуск Node.js
pm2 restart messenger

# Проверка Nginx конфига
echo ""
echo "=== Проверка конфига Nginx ==="
if grep -q "/uploads" /etc/nginx/sites-available/messenger; then
    echo "✓ /uploads уже есть в конфиге"
else
    echo "✗ Добавляю /uploads в конфиг..."
    # Добавляем location для /uploads
    sudo sed -i '/location \/api {/,/}/ { /}/a\
\
    location /uploads {\
        proxy_pass http://localhost:3000;\
        proxy_http_version 1.1;\
        proxy_set_header Upgrade $http_upgrade;\
        proxy_set_header Connection "upgrade";\
        proxy_set_header Host $host;\
    }
}' /etc/nginx/sites-available/messenger
    sudo nginx -t && sudo systemctl reload nginx
fi

# Проверка прав на папку uploads
echo ""
echo "=== Проверка папки uploads ==="
if [ ! -d "uploads" ]; then
    echo "Создаю папку uploads..."
    mkdir -p uploads
fi
chmod 755 uploads
echo "Права на uploads: $(ls -la uploads | head -1)"

echo ""
echo "=== Готово! ==="