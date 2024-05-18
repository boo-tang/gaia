import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import sortBy from 'lodash/sortBy';

import { RootState } from '../store';
import { Loc } from '../types';

interface LocationsState {
  selectedLocations: Loc[];
}

const initialState: LocationsState = {
  selectedLocations: [],
};

export const locationsSlice = createSlice({
  name: 'locations',
  initialState,
  reducers: {
    toggleLocation: (state: LocationsState, action: PayloadAction<Loc>) => {
      // Redux Toolkit allows us to write "mutating" logic in reducers. It
      // doesn't actually mutate the state because it uses the Immer library,
      // which detects changes to a "draft state" and produces a brand new
      // immutable state based off those changes
      const { payload: loc } = action;
      const filteredLocs = state.selectedLocations.filter(
        (selectedLoc) =>
          !(selectedLoc.lat === loc.lat && selectedLoc.lng === loc.lng),
      );
      if (filteredLocs.length !== state.selectedLocations.length) {
        // if length changed, then we removed existing item, update locs
        state.selectedLocations = filteredLocs;
      } else {
        // if length is same, location is new so add and update
        const updatedLocs = state.selectedLocations.concat(loc);
        state.selectedLocations = sortBy(updatedLocs, ['lat', 'lng']);
      }
    },
    resetLocations: (state: LocationsState, action: PayloadAction) => {
      state.selectedLocations = [];
    },
  },
});

// Action creators are generated for each case reducer function
export const { toggleLocation, resetLocations } = locationsSlice.actions;

export const getSelectedLocations = (state: RootState) => state.locations;

export default locationsSlice.reducer;
