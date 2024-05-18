import { configureStore } from '@reduxjs/toolkit';

import locationsReducer from './state/locations';

export const store = configureStore({
  reducer: {
    locations: locationsReducer,
  },
});

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
// Inferred type: {posts: LocationsState}
export type AppDispatch = typeof store.dispatch;
