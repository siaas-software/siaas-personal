// Stable source-release metadata only. No binary auto-updater or renderer shell access.
class DesktopUpdates {
 constructor({version,supported,notify=()=>{},request=(...args)=>fetch(...args)}){
  Object.assign(this,{version,supported,notify,request});
  this.state={phase:"idle",version,supported,nextVersion:null,lastChecked:null,message:"",releaseNotes:null};
  this.pending=false;
 }
 set(partial){this.state={...this.state,...partial};this.notify(this.state);return this.state}
 async check(){
  if(this.pending)return this.state;
  if(!this.supported)return this.set({phase:"unsupported",message:"Source installation required for in-app updates."});
  this.pending=true;this.set({phase:"checking",message:"Checking GitHub Releases…"});
  try{
   const response=await this.request("https://api.github.com/repos/siaas-software/siaas-personal/releases/latest",{headers:{"Accept":"application/vnd.github+json"},signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw new Error(response.status===403?"GitHub API rate limit or access restriction. Try again later.":"GitHub returned HTTP "+response.status);
   const release=await response.json();
   if(release.draft||release.prerelease||!/^v?\d+\.\d+\.\d+$/.test(release.tag_name))throw new Error("No valid stable release available.");
   const latest=release.tag_name.replace(/^v/,"");
   const compare=(a,b)=>{const x=a.split(".").map(Number),y=b.split(".").map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];return 0};
   const available=compare(latest,this.version)>0;
   return this.set({phase:available?"available":"current",nextVersion:latest,releaseNotes:release.html_url,lastChecked:new Date().toISOString(),message:available?"New stable version available.":"You are up to date."});
  }catch(e){return this.set({phase:"failed",message:e.message})}
  finally{this.pending=false}
 }
}
module.exports={DesktopUpdates};
