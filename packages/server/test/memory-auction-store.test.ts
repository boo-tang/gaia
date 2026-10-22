import { MemoryAuctionStore } from '../src/store/memory-auction-store';
import { auctionStoreSuite } from './auction-store.suite';

auctionStoreSuite('MemoryAuctionStore', options => new MemoryAuctionStore(options));
