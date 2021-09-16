import { COOR_PRECISION } from '../constants'

export const fromCoorToUint = ({ lat, lng }) => {
  /**
   * Lat can have values from -90.00 -> 90.00
   * Lng can have values from -180.00 -> 180.00
   * we want positive integers so the ranges become:
   * lat: 0 -> 18,000
   * lng: 0 -> 36,000
   */
  const chainLat = Math.round((lat + 90) * COOR_PRECISION)
  const chainLng = Math.round((lng + 180) * COOR_PRECISION)

  // chain functions work with 2-element array structures: [lat, lng]
  const result = { lat: chainLat, lng: chainLng }
  return result
}

export const fromUintToCoor = ([chainLat, chainLng]) => {
  /**
   * Lat can have values from -90.00 -> 90.00
   * Lng can have values from -180.00 -> 180.00
   * we want positive integers so the ranges become:
   * lat: 0 -> 18,000
   * lng: 0 -> 36,000
   */
  const lat = Math.round(chainLat - 9000 + Number.EPSILON) / COOR_PRECISION
  const lng = Math.round(chainLng - 18000 + Number.EPSILON) / COOR_PRECISION

  // chain functions work with 2-element array structures: [lat, lng]
  const result = { lat, lng }
  return result
}

export const getLocationBounds = ({ lat, lng }) => [
  [lat - 0.5 / COOR_PRECISION, lng - 0.5 / COOR_PRECISION],
  [lat + 0.5 / COOR_PRECISION, lng + 0.5 / COOR_PRECISION],
]
