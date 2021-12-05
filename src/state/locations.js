import { createSlice } from '@reduxjs/toolkit'
import { sortBy } from 'lodash'

const initialState = {
  selectedLocations: [],
}

export const locationsSlice = createSlice({
  name: 'locations',
  initialState,
  reducers: {
    toggleLocation: (state, action) => {
      // Redux Toolkit allows us to write "mutating" logic in reducers. It
      // doesn't actually mutate the state because it uses the Immer library,
      // which detects changes to a "draft state" and produces a brand new
      // immutable state based off those changes
      const { payload: loc } = action
      const filteredLocs = state.selectedLocations.filter(
        selectedLoc =>
          !(selectedLoc.lat === loc.lat && selectedLoc.lng === loc.lng),
      )
      if (filteredLocs.length !== state.selectedLocations.length) {
        // if length changed, then we removed existing item, update locs
        state.selectedLocations = filteredLocs
      } else {
        // if length is same, location is new so add and update
        const updatedLocs = state.selectedLocations.concat(loc)
        state.selectedLocations = sortBy(updatedLocs, ['lat', 'lng'])
      }
    },
    resetLocations: (state, action) => {
      state.selectedLocations = []
    },
  },
})

// Action creators are generated for each case reducer function
export const { toggleLocation, resetLocations } = locationsSlice.actions

export default locationsSlice.reducer
