/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>'],
  transform: {
    '^.+\.tsx?$': ['ts-jest', { useESM: true }],
    '^.+\.jsx?$': 'babel-jest',
  },
  transformIgnorePatterns: [
    "node_modules/(?!parse5|jsdom|whatwg-url)"
  ],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    // Handle specific aliases if any
  },
};
