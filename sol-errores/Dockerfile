# Etapa 1: Build de la aplicación frontend (Vite/React)
FROM node:18-alpine AS builder

WORKDIR /app

# Copiamos primero los archivos de dependencias para aprovechar la caché de Docker
COPY package*.json ./

# Instalamos las dependencias
RUN npm install

# Copiamos todo el código fuente del frontend
COPY . .

# Construimos la aplicación para producción (esto generará la carpeta 'dist')
RUN npm run build

# Etapa 2: Servidor web ligero (Nginx) para servir los archivos
FROM nginx:alpine

# Copiamos nuestra configuración de Nginx para enrutamiento (React Router)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Limpiamos la carpeta html por defecto de Nginx
RUN rm -rf /usr/share/nginx/html/*

# Copiamos los archivos generados ('dist') desde la etapa anterior al servidor Nginx
COPY --from=builder /app/dist /usr/share/nginx/html

# Exponemos el puerto 80 (el que lee Dockploy/Internet)
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
