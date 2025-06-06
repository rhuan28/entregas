# Dockerfile para o backend (versão corrigida)
FROM node:18-alpine

# 1. Define o diretório de trabalho já dentro de uma pasta 'backend'
WORKDIR /app/backend

# 2. Copia os arquivos de dependência para o diretório de trabalho (/app/backend)
COPY backend/package*.json ./

# 3. Executa a instalação das dependências DENTRO de /app/backend
RUN npm ci --only=production

# 4. Copia o código-fonte do backend para o diretório de trabalho (/app/backend)
COPY backend/ .

# Expõe a porta
EXPOSE 3000

# 5. O comando 'npm start' será executado a partir de /app/backend
CMD ["npm", "start"]