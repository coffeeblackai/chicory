const path = require('path');

module.exports = {
  mode: 'development',
  entry: './src/renderer.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'src', 'dist'),
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader'
        }
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  resolve: {
    extensions: ['.js', '.jsx']
  }
}; 