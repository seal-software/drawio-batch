#!/usr/bin/env node

'use strict'

var fs = require('fs')
var libxmljs = require("libxmljs");

const program = require('commander')

function parseQuality (val) {
  var number = parseInt(val)
  if (isNaN(number) || number <= 0 || number > 100) {
    throw new Error('Invalid quality value given')
  }
  return number
}

function parseScale (val) {
  var number = parseFloat(val)
  if (isNaN(number) || number <= 0) {
    throw new Error('Invalid scale value given')
  }
  return number
}

function parseDiagramId(val) {
  let number = parseInt(val, 10)
  if (isNaN(number) ||  number <= 0) {
    throw new Error('Invalid diagram-id value given')
  }
  return number
}

function supportedFormats (ext) {
  if(!ext.match(/^(pdf|png|jpg)$/)) {
    throw new Error('Invalid format value given')
  } 
  return ext;
}

var input = null
var output = null

program
  .name('drawio-batch')
  .version(require('./package.json').version)
  .option('-f --format <format>',
    'export format [png|pdf|jpg].', supportedFormats, 'pdf')
  .option('-q --quality <quality>',
    'output image quality for JPEG (0..100)', parseQuality, 75)
  .option('-s --scale <scale>',
    'scales the output file size for pixel-based output formats', parseScale, 1.0)
  .option('-d --diagram-id <diagramId>',
    'selects a specific diagram to export, page index (starting at 0)', parseDiagramId, -1)
  .arguments('<input> <output>')
  .action(function (newInput, newOutput) {
    input = fs.readFileSync(newInput, 'utf-8')
    output = newOutput
  })
  .parse(process.argv)

const puppeteer = require('puppeteer')

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function diagrams(xml) {
  var xmlDoc= libxmljs.parseXml(xml)
    var root = xmlDoc.get('//mxfile')
    var childNodes = root.childNodes();

    return childNodes.map(e => {
      return e.attr('name').value()
    });
}

async function exportDiagram(page, id, program, output) {
  await page.goto('file://' + __dirname + '/drawio/src/main/webapp/export2.html', {waitUntil: 'domcontentloaded'})
  
  var bounds = await page.evaluate(function (xml, format, scale, diagramId) {
    return new Promise(function (resolve, reject) {
      window.callPhantom = function (bounds) {
        resolve(bounds)
      }
      render({ xml: xml, format: format, scale: scale, from: diagramId
      })
    })
  }, input, program.format, program.scale, id)

  var width = Math.ceil(bounds.x + bounds.width)
  var height = Math.ceil(bounds.y + bounds.height) 

  await page.setViewport({width: width, height: height, deviceScaleFactor: 1})
  console.log("Exporting page " + id + ": " + output)
  if (program.format === 'pdf') {
    await page.pdf({path: output, width: width, height: height + 1, pageRanges: '1'})
  } else if(program.format === 'png') {
    await page.screenshot({path: output, clip: bounds})
  } else {
    await page.screenshot({path: output, clip: bounds, quality: program.quality})
  }
}

function createOutputFolder(output) {
  if (!fs.existsSync(output)) {
    fs.mkdirSync(output)
  }
}

function resolveOutput(output, program, diagram) {
  return output + "/" + diagram + "." + program.format
}

(async () => {
  const browser = await puppeteer.launch({args: ['--no-sandbox', '--allow-file-access-from-files'], dumpio: true /*, headless: false */ })
  try {
    await input
    const page = await browser.newPage()
  
    createOutputFolder(output)
    
    const pages = diagrams(input)

    for (let i = 0; i < pages.length; i++) {
      const diagram = pages[i];
      if(program.diagramId < 0 || program.diagramId === i) {
        await exportDiagram(page, i, program, resolveOutput(output, program, diagram))
      }
    }
    
  } catch (error) {
    console.log(error)
    process.exit(1)
  } finally {
    await browser.close()
  }
})()
