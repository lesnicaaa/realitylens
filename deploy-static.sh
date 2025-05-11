#!/bin/bash

# RealityLens Static Deployment Script

echo "Preparing static version of RealityLens..."

# Create a deploy directory
mkdir -p dist

# Copy static files
cp index.html dist/
cp app.js dist/
cp 404.html dist/
cp -r src dist/
cp static.json dist/

echo "Static files prepared in the dist directory"
echo "You can now deploy this to a static hosting service like GitHub Pages"
echo "Or use: npx surge dist/ your-subdomain.surge.sh to deploy to Surge.sh (free)" 