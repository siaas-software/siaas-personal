import subprocess,json,time,os
from pathlib import Path
root=Path('/workspace/scratch/8e6ae998bf9b/app')
logs=root.parent/'rc5-validation'
os.chdir(root)
os.environ['CHROMIUM_EXECUTABLE_PATH']=str(root.parent/'browser/chrome-headless-shell-linux64/chrome-headless-shell')
os.environ['CHROMIUM_PATH']=os.environ['CHROMIUM_EXECUTABLE_PATH']
checks=[('unit','npm test'),('types','npm run typecheck'),('research','npm run test:research'),('distribution','npm run test:distribution'),('installer','npm run test:installer'),('cli','node --test tests/cli-quiescence.test.mjs tests/source-manager-characterization.test.mjs'),('icons','npm run icons:check'),('web-build','npm run build'),('desktop-build','npm run desktop:build'),('chat','npm run test:chat'),('knowledge','npm run test:knowledge'),('actions','npm run test:actions:api'),('templates','node tests/template-api.mjs'),('structured','node tests/structured-api.mjs --ui'),('hybrid','node tests/structured-api.mjs --hybrid --offline --ui'),('project','node --import tsx tests/project-chat-api.mjs --ui'),('ui','npm run test:ui'),('experimental','node tests/experimental-api.mjs'),('licenses','node tests/licenses-integration.mjs'),('bundle','node tests/structured-bundle.test.mjs'),('prepare','npm run desktop:prepare'),('package','npx --no-install electron-builder --config electron-builder.cjs --linux --x64 --dir --publish never --config.electronDist=node_modules/electron/dist')]
results=[]
for name,cmd in checks:
 print('RUN '+name,flush=True);start=time.time()
 with open(logs/(name+'.log'),'w') as out:r=subprocess.run(cmd,shell=True,stdout=out,stderr=subprocess.STDOUT)
 result=dict(name=name,command=cmd,status='PASS' if r.returncode==0 else 'FAIL',code=r.returncode,seconds=round(time.time()-start,2))
 results.append(result);(logs/'results.json').write_text(json.dumps(results,indent=2)+'\n')
 print(json.dumps(result),flush=True)
 if r.returncode and name in ['web-build','desktop-build']:break
