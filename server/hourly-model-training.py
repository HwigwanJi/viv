"""Production entry for the existing bootstrapped market-path forest trainer."""
import os
for key in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS']:
    os.environ[key]='1'
import ctypes,json,sys,math
import numpy as np
from datetime import datetime

if os.name=='nt':
    ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(),0x4000)

def fit(rows,settings):
    X=np.array([r['x'] for r in rows]);Y=np.array([[math.log1p(v) for v in r['y']] for r in rows])
    scales=np.maximum(Y.std(axis=0),.002);rng=np.random.default_rng(settings["seed"])
    def node(ix,level):
        y=Y[ix];leaf={'values':y.mean(axis=0).tolist(),'count':len(ix)}
        if level>=settings["maxDepth"] or len(ix)<2*settings["minLeaf"]:return leaf
        baseline=np.var(y/scales,axis=0).sum()*len(ix);best=None
        for j in rng.choice(8,4,replace=False):
            for cut in np.unique(np.quantile(X[ix,j],[.25,.5,.75])):
                mask=X[ix,j]<=cut;n=int(mask.sum())
                if min(n,len(ix)-n)<settings["minLeaf"]:continue
                score=np.var(y[mask]/scales,axis=0).sum()*n+np.var(y[~mask]/scales,axis=0).sum()*(len(ix)-n)
                if best is None or score<best[0]:best=(score,int(j),float(cut),mask)
        if best is None or baseline-best[0]<=1e-10:return leaf
        _,j,cut,mask=best
        return {'feature':j,'threshold':cut,'left':node(ix[mask],level+1),'right':node(ix[~mask],level+1)}
    def flatten(root):
        out=[]
        def walk(n):
            k=len(out);out.append(None)
            out[k]=n if 'values' in n else {'feature':n['feature'],'threshold':n['threshold'],'left':walk(n['left']),'right':walk(n['right'])}
            return k
        walk(root);return out
    return [flatten(node(rng.integers(0,len(rows),size=len(rows)),0)) for _ in range(settings["trees"])]

if __name__=='__main__':
    value=json.load(sys.stdin);rows=value['rows'];cutoff=datetime.fromisoformat(value['cutoff'].replace('Z','+00:00'))
    assert 80<=len(rows)<=100000
    assert all(len(r['x'])==8 and len(r['y'])==2 and all(math.isfinite(v) for v in r['x']+r['y']) and all(v>-1 for v in r['y']) and r['y'][1]<=r['y'][0] and datetime.fromisoformat(r['labelAt'].replace('Z','+00:00'))<=cutoff for r in rows)
    settings=value.get('settings',{'trees':16,'maxDepth':4,'minLeaf':40,'seed':20261027})
    assert all(isinstance(settings[k],int) for k in ['trees','maxDepth','minLeaf','seed'])
    assert 1<=settings['trees']<=32 and 1<=settings['maxDepth']<=5 and 1<=settings['minLeaf']<=100000 and 0<=settings['seed']<=4294967295
    json.dump({'trees':fit(rows,settings)},sys.stdout,separators=(',',':'),allow_nan=False)
