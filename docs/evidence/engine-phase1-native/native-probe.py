"""Bounded diagnostic, not a native installation acceptance framework."""
import io,json,os,pathlib,platform,resource,signal,subprocess,tarfile,tempfile,shutil,time
repo=pathlib.Path('/workspace/siaas-personal')
out=pathlib.Path('/workspace/engine-native-evidence')
node='/workspace/rc3-toolchain/node-v24.22.0-linux-x64/bin/node'
electron=str(repo/'node_modules/electron/dist/electron')
baseline='17202c5964d9282efd4a1991c548612287c65dbb'
head='71676c6cda1629b594b4cbca2be9941169de77f3'
base=pathlib.Path(tempfile.mkdtemp(prefix='siaas-native-acceptance-'))
results={'baseline':baseline,'head':head,'os':platform.platform(),'node':subprocess.check_output([node,'--version'],text=True).strip(),'electron':(repo/'node_modules/electron/dist/version').read_text().strip(),'uid':os.getuid(),'temporaryRoot':str(base),'runs':[]}
# No credentials or unsafe Node/Electron options are inherited by probes.
env={k:os.environ[k] for k in ['PATH','LANG','LC_ALL','DISPLAY','WAYLAND_DISPLAY'] if k in os.environ}
resource.setrlimit(resource.RLIMIT_CORE,(0,0))
def run(label,cmd,cwd,env):
    start=time.monotonic();proc=subprocess.Popen(cmd,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True)
    timedout=False
    try:stdout,_=proc.communicate(timeout=20)
    except subprocess.TimeoutExpired:
        timedout=True;os.killpg(proc.pid,signal.SIGTERM)
        try:stdout,_=proc.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid,signal.SIGKILL);stdout,_=proc.communicate(timeout=3)
    # Terminate only a surviving process group created by this probe, if any.
    try:os.killpg(proc.pid,0)
    except ProcessLookupError:groupGone=True
    else:
        os.killpg(proc.pid,signal.SIGTERM);time.sleep(.2)
        try:os.killpg(proc.pid,0)
        except ProcessLookupError:groupGone=True
        else:groupGone=False
    (out/(label+'.log')).write_text(stdout)
    results['runs'].append({'label':label,'command':cmd,'cwd':str(cwd),'exitCode':proc.returncode,'timedOut':timedout,'pid':proc.pid,'ownedProcessGroupGone':groupGone,'durationSeconds':round(time.monotonic()-start,3),'outputFile':label+'.log'})
    print(label,'exit',proc.returncode,'group gone',groupGone,flush=True)
try:
    old=base/'baseline';old.mkdir()
    archive=subprocess.check_output(['git','archive',baseline,'desktop','scripts','package.json','package-lock.json','runtime.json'],cwd=repo)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:tar.extractall(old,filter='data')
    for name,tree in [('baseline',old),('refactored',repo)]:
        target=base/name/'probe';target.mkdir(parents=True)
        childenv=dict(env)
        for var,part in [('XDG_CONFIG_HOME','config'),('XDG_CACHE_HOME','cache'),('XDG_DATA_HOME','data'),('XDG_RUNTIME_DIR','runtime'),('TMPDIR','tmp')]:
            path=target/part;path.mkdir(mode=0o700);childenv[var]=str(path)
        childenv['SIAAS_INSTALL_DIR']=str(target/'installation')
        childenv['SIAAS_NODE_EXECUTABLE']=node
        profile=target/'profile'
        run(name+'-electron',[electron,str(tree/'desktop/main.cjs'),'--enable-sandbox','--user-data-dir='+str(profile)],tree,childenv)
        results['runs'][-1]['requestedProfile']=str(profile)
        results['runs'][-1]['profileCreated']=profile.exists()
        run(name+'-status',[node,str(tree/'scripts/source-manager.mjs'),'status'],tree,childenv)
        run(name+'-capabilities',[node,str(tree/'scripts/source-manager.mjs'),'capabilities'],tree,childenv)
        manifest=target/'invalid-manifest.json';manifest.write_text('{"schemaVersion":999}')
        run(name+'-invalid-install',[node,str(tree/'scripts/source-manager.mjs'),'install','--manifest',str(manifest)],tree,childenv)
        results['runs'][-1]['lockRemaining']=(target/'installation/.operation-lock').exists()
        results['runs'][-1]['metadataCreated']=(target/'installation/current.json').exists()
        run(name+'-stable-relative-root',['bash',str(tree/'scripts/install.sh')],tree,{**childenv,'SIAAS_INSTALL_DIR':'relative-test-root'})
        run(name+'-rc-missing-tag',['bash',str(tree/'scripts/install-rc.sh')],tree,childenv)
    # Minimal real Electron control: same failure before any Personal application code.
    control=base/'control.cjs';control.write_text("const {app}=require('electron');app.enableSandbox();app.whenReady().then(()=>{console.log('CONTROL_READY');app.quit();});\n")
    run('electron-control',[electron,str(control),'--enable-sandbox','--user-data-dir='+str(base/'control-profile')],base,childenv)
finally:
    shutil.rmtree(base)
    results['temporaryRootRemoved']=not base.exists()
    (out/'native-probe-results.json').write_text(json.dumps(results,indent=2)+'\n')
    print('temporary root removed',not base.exists(),flush=True)
