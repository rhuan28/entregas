// database/knexfile.js
module.exports = {
  development: {
    client: 'sqlite3',
    connection: {
      filename: './confeitaria.db'
    },
    useNullAsDefault: true,
    migrations: {
      directory: './migrations'
    }
  }
};