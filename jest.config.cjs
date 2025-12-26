/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jest-environment-jsdom',
  roots: ['<rootDir>'],
  setupFiles: ['<rootDir>/setup-tests.js'],
  transform: {
    '^.+\.tsx?$': 'ts-jest',
    '^.+\.js$': 'babel-jest',
  },
  transformIgnorePatterns: [
    "/node_modules/(?!jsdom|parse5|whatwg-url|@whatwg-node)"
  ],
  moduleNameMapper: {
    // Handle specific aliases if any
  },
};
