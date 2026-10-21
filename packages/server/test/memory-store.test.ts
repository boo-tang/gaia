import { MemoryStore } from '../src/store/memory';
import { storeSuite } from './store.suite';

storeSuite('MemoryStore', (options) => new MemoryStore(options));
