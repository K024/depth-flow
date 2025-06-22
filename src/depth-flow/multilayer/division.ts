

export function depthMapHistogram(depthMap: ImageData) {
  const histogram: number[] = new Array(256).fill(0)

  for (let i = 0; i < depthMap.data.length; i += 4) {
    const r = depthMap.data[i]
    histogram[r]++
  }

  return histogram
}

export function percentileBasedDivision(histogram: number[], numLayers = 3) {
  const totalPixels = histogram.reduce((sum, count) => sum + count, 0)
  const pixelsPerLayer = totalPixels / numLayers

  const divisionPoints: number[] = []
  let cumulativePixels = 0

  for (let i = 0; i < 256; i++) {
    cumulativePixels += histogram[i]

    if (divisionPoints.length < numLayers - 1 &&
      cumulativePixels >= pixelsPerLayer * (divisionPoints.length + 1)) {
      divisionPoints.push(i)
    }
  }

  return divisionPoints
}


const valleyThreshold = 1

export function valleyBasedDivision(histogram: number[], numLayers = 10) {
  const smoothed = new Array(256).fill(0)
  const windowSize = 8

  for (let i = 0; i < 256; i++) {
    let sum = 0
    let count = 0
    const left = Math.max(0, i - windowSize)
    const right = Math.min(255, i + windowSize)
    for (let j = left; j <= right; j++) {
      sum += histogram[j]
      count++
    }
    smoothed[i] = sum / count + Math.random() / 100
  }

  const avg = smoothed.reduce((a, b) => a + b, 0) / smoothed.length

  // consoleLogHistogram(smoothed, [])

  const valleys: { index: number, value: number }[] = []
  for (let i = 1; i < 255; i++) {
    if (smoothed[i] < avg * valleyThreshold && smoothed[i] < smoothed[i - 1] && smoothed[i] < smoothed[i + 1]) {
      valleys.push({ index: i, value: smoothed[i] })
    }
  }

  valleys.sort((a, b) => a.value - b.value)

  const divisionPoints = valleys
    .slice(0, numLayers - 1)
    .map(v => v.index)
    .sort((a, b) => a - b)

  return divisionPoints.length > 0 ? divisionPoints : percentileBasedDivision(histogram, numLayers)
}



let filterThreshold = 0.10

function filterDivisionPoints(histogram: number[], divisionPoints: number[]) {
  const totalPixels = histogram.reduce((sum, count) => sum + count, 0)
  divisionPoints = [...new Set(divisionPoints)].sort((a, b) => a - b)

  const filteredPoints = []
  let prevPoint = 0

  for (const point of divisionPoints) {
    let pixelCount = 0
    for (let i = prevPoint; i <= point; i++) {
      pixelCount += histogram[i]
    }

    const ratio = pixelCount / totalPixels
    if (ratio >= filterThreshold) {
      filteredPoints.push(point)
      prevPoint = point
    }
  }

  return filteredPoints
}



const valleyCandidates = 12
const percentileCandidates = 5


export function multilayerDepthMapDivisions(depthMap: ImageData) {
  const histogram = depthMapHistogram(depthMap)

  const valleysPoints = valleyBasedDivision(histogram, valleyCandidates)

  const percentilePoints = percentileBasedDivision(histogram, percentileCandidates)

  const divisionPoints = percentilePoints.map(point => {
    const distances = valleysPoints.map(value => Math.abs(point - value))
    const min = Math.min(...distances)
    const minIndex = distances.findIndex(x => x === min)
    return valleysPoints[minIndex]
  })

  return {
    histogram,
    divisionPoints: filterDivisionPoints(histogram, divisionPoints),
  }
}

