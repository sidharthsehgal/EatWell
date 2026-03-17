# Stage 1: Build
FROM node:20-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:stable-alpine
# Copy the built files from Stage 1
COPY --from=build /app/dist /usr/share/nginx/html
# Default Cloud Run port is 8080
EXPOSE 8080
# Update nginx config to listen on 8080 (Cloud Run requirement)
RUN sed -i 's/80/8080/g' /etc/nginx/conf.d/default.conf
CMD ["nginx", "-g", "daemon off;"]
