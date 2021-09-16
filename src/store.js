import { configureStore } from '@reduxjs/toolkit'

import locationsReducer from './state/locations'

export const store = configureStore({
  reducer: {
    locations: locationsReducer,
  },
})
