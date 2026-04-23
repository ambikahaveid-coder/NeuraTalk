const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Neura-Talk API',
      version: '1.0.0',
      description: 'Production API for Neura-Talk (B2B, B2C, C2C)',
      contact: {
        name: 'Neura-Talk Support',
        email: 'support@neuratalk.app'
      }
    },
    servers: [
      { url: 'http://localhost:5000', description: 'Local Dev' },
      { url: 'https://api.neuratalk.app', description: 'Production' }
    ],
  },
  apis: ['./server/routes/*.ts', './server/routes/*.js'], // Scans all routes for JSDoc
};

const specs = swaggerJsdoc(options);
module.exports = { specs, swaggerUi };