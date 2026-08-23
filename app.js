const express = require('express');
const path = require('path');
const OpenApiValidator = require('express-openapi-validator');
const app = express();
app.use(express.json());

app.use(
    OpenApiValidator.middleware({
        apiSpec: path.join(__dirname, 'openapi/openapi.yaml'),
        validateRequests: true,
        validateResponses: true,
    })
);

app.get('/products', (req, res) => {
    res.json({
        items: [],
        next_cursor: null,
    });
});

app.get('/orders', (req, res) => {
    res.json({
        items: [],
        next_cursor: null,
    });
});

app.post('/orders', (req, res) => {
    const requestBody = req.body;
    const item = {
        id: 1,
        items: requestBody.items,
    }
    res.status(201).json(item)
});

app.use((err, req, res, next) => {
    res
        .status(err.status || 500)
        .type('application/problem+json')
        .json({
            type: 'about:blank',
            title: err.message,
            status: err.status || 500,
            detail: err.message,
            instance: req.originalUrl,
        });
});

app.listen(3000, () => console.log('http://localhost:3000'));
