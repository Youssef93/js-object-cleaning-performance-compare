const myCleaner = require('./module');
const deepClean = require('clean-deep');
const cleaner = require('deep-cleaner');
const fs = require('fs');
const path = require('path');
const files = fs.readdirSync('./samples')
const { performance } = require('perf_hooks')

files.forEach(fileName => {
  const objToClean = require(path.join(__dirname, 'samples', fileName));

  console.log('Performing Measures on', fileName);

  console.log("using deep-cleaner");
  const deepCleanerT1 = performance.now();
  cleaner(objToClean);
  const deepCleanerT2 = performance.now()
  console.log(`Used ~ ${deepCleanerT2 - deepCleanerT1} ms \n`);

  console.log("using clean-deep");
  const cleanDeepT1 = performance.now();
  deepClean(objToClean);
  const cleanDeepT2 = performance.now()
  console.log(`Used ~ ${cleanDeepT2 - cleanDeepT1} ms \n`);


  console.log("using my new cleaner");
  const pT1 = performance.now();
  myCleaner.clean(objToClean, { nullCleaner: true });
  const pT2 = performance.now()
  console.log(`Used ~ ${pT2 - pT1} ms`);

  console.log('-----------');
});