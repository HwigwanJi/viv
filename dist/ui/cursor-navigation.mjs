/** Cursor predecessors belong to a query and survive native browser Back. */
export function createCursorHistory(){
  const links=new Map();
  const key=(query,cursor)=>{const scope=new URLSearchParams(query);scope.delete('cursor');scope.sort();return JSON.stringify([scope.toString(),cursor||null]);};
  return {
    remember(query,nextCursor){links.set(key(query,nextCursor),query.get('cursor')||null);},
    previous(query){return links.get(key(query,query.get('cursor')))||null;},
    has(query){return links.has(key(query,query.get('cursor')));},
    reset(){links.clear();}
  };
}
