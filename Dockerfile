# Dockerfile para o backend
FROM node:18-alpine

# Define o diretório de trabalho
WORKDIR /app

# Copia os arquivos de dependências
COPY backend/package*.json ./

# Instala as dependências
RUN npm ci --only=production

# Copia o código fonte
COPY backend/ .

# Expõe a porta
EXPOSE 3000

# Comando para iniciar a aplicação
CMD ["npm", "start"]