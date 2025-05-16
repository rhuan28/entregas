// services/googleMaps.js
const axios = require('axios');
require('dotenv').config();

class GoogleMapsService {
    constructor() {
        this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
        this.baseURL = 'https://maps.googleapis.com/maps/api';
    }

    // Geocodifica um endereço para obter coordenadas
    async geocodeAddress(address) {
        try {
            const response = await axios.get(`${this.baseURL}/geocode/json`, {
                params: {
                    address: address,
                    key: this.apiKey,
                    region: 'br'
                }
            });

            if (response.data.status === 'OK' && response.data.results.length > 0) {
                const location = response.data.results[0].geometry.location;
                return {
                    lat: location.lat,
                    lng: location.lng,
                    formatted_address: response.data.results[0].formatted_address
                };
            } else if (response.data.status === 'ZERO_RESULTS') {
                throw new Error('Endereço não encontrado');
            } else if (response.data.status === 'REQUEST_DENIED') {
                throw new Error('API key inválida ou sem permissões');
            } else {
                throw new Error(`Erro da API: ${response.data.status}`);
            }
        } catch (error) {
            console.error('Erro ao geocodificar:', error);
            throw error;
        }
    }

    // Calcula distância e tempo entre dois pontos
    async getDistanceMatrix(origin, destinations) {
        try {
            const response = await axios.get(`${this.baseURL}/distancematrix/json`, {
                params: {
                    origins: `${origin.lat},${origin.lng}`,
                    destinations: destinations.map(d => `${d.lat},${d.lng}`).join('|'),
                    key: this.apiKey,
                    mode: 'driving',
                    language: 'pt-BR'
                }
            });

            return response.data;
        } catch (error) {
            console.error('Erro ao calcular distância:', error);
            throw error;
        }
    }

    // Obtém direções entre pontos
    async getDirections(origin, destination, waypoints = []) {
        try {
            const params = {
                origin: `${origin.lat},${origin.lng}`,
                destination: `${destination.lat},${destination.lng}`,
                key: this.apiKey,
                mode: 'driving',
                language: 'pt-BR'
            };

            if (waypoints.length > 0) {
                params.waypoints = waypoints.map(w => `${w.lat},${w.lng}`).join('|');
                params.optimize = true;
            }

            const response = await axios.get(`${this.baseURL}/directions/json`, params);
            
            if (response.data.status !== 'OK') {
                throw new Error(`API Error: ${response.data.status}`);
            }
            
            return response.data;
        } catch (error) {
            console.error('Erro ao obter direções:', error);
            throw error;
        }
    }
}

module.exports = new GoogleMapsService();