import {createNativePageDriver} from './native-page-driver.mjs';

export function createNativeLiepinDriver(options){
 return createNativePageDriver({...options,platform:'liepin'});
}
