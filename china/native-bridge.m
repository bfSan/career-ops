#import <Foundation/Foundation.h>
#import <ScriptingBridge/ScriptingBridge.h>
#include <libproc.h>

// Selectors from Chrome's shipped scripting.sdef. The PID is the owned child,
// never the bundle identifier or the frontmost ordinary Chrome window.
@interface SBObject (CareerOpsChrome)
- (SBElementArray *)windows;
- (SBElementArray *)tabs;
- (NSString *)id;
- (NSString *)URL;
- (void)setURL:(NSString *)url;
- (id)executeJavascript:(NSString *)source;
@end
@interface BridgeErrors : NSObject <SBApplicationDelegate>
@property NSInteger code;
@property NSString *stage;
@property NSString *failedAt;
@end
@implementation BridgeErrors
- (id)eventDidFail:(const AppleEvent *)event withError:(NSError *)error { self.code=error.code;self.failedAt=self.stage;return nil; }
@end

int main(void){@autoreleasepool{
  NSData *input=[[NSFileHandle fileHandleWithStandardInput] readDataToEndOfFile];
  if(input.length>1024*1024)return 2;
  NSDictionary *args=[NSJSONSerialization JSONObjectWithData:input options:0 error:nil];
  if(![args isKindOfClass:[NSDictionary class]]||![args[@"pid"] isKindOfClass:[NSNumber class]]||[args[@"pid"] intValue]<=0)return 2;
  struct proc_bsdinfo info;
  if(proc_pidinfo([args[@"pid"] intValue],PROC_PIDTBSDINFO,0,&info,sizeof(info))!=sizeof(info)||info.pbi_ppid!=[args[@"parentPid"] intValue]){puts("{\"errorCode\":-1728,\"errorStage\":\"process_identity\"}");return 0;}
  NSString *identity=[NSString stringWithFormat:@"%llu-%llu",info.pbi_start_tvsec,info.pbi_start_tvusec];
  if(args[@"processIdentity"]&&![identity isEqual:args[@"processIdentity"]]){puts("{\"errorCode\":-1728,\"errorStage\":\"process_identity\"}");return 0;}
  SBApplication *app=[SBApplication applicationWithProcessIdentifier:[args[@"pid"] intValue]];
  app.timeout=180;app.sendMode=kAEWaitReply|kAENeverInteract;
  BridgeErrors *errors=[BridgeErrors new];app.delegate=errors;
  NSMutableDictionary *reply=[@{@"errorCode":@0,@"processIdentity":identity} mutableCopy];
  NSMutableArray *tabs=[NSMutableArray array];
  SBObject *selected=nil;
  errors.stage=@"enumerate_tabs";
  if(app.isRunning){for(SBObject *window in [app windows])for(SBObject *tab in [window tabs]){
    NSString *wid=[window id],*tid=[tab id];
    if([args[@"command"] isEqual:@"tabs"])[tabs addObject:@{@"windowId":wid?:@"",@"tabId":tid?:@"",@"url":[tab URL]?:@""}];
    else if([wid isEqual:args[@"windowId"]]&&[tid isEqual:args[@"tabId"]])selected=tab;
  }}
  if([args[@"command"] isEqual:@"tabs"])reply[@"tabs"]=tabs;
  else if(!selected){reply[@"errorCode"]=@(-1728);reply[@"errorStage"]=@"selected_tab_missing";}
  else if([args[@"command"] isEqual:@"evaluate"]&&[args[@"source"] isKindOfClass:[NSString class]]){errors.stage=@"execute_javascript";reply[@"result"]=[selected executeJavascript:args[@"source"]]?:[NSNull null];}
  else if([args[@"command"] isEqual:@"navigate"]&&[args[@"url"] isKindOfClass:[NSString class]]){errors.stage=@"navigate";[selected setURL:args[@"url"]];}
  else reply[@"errorCode"]=@(-1708);
  if(errors.code){reply[@"errorCode"]=@(errors.code);reply[@"errorStage"]=errors.failedAt?:@"unknown";}
  NSData *output=[NSJSONSerialization dataWithJSONObject:reply options:0 error:nil];
  if(!output)return 2;
  fwrite(output.bytes,1,output.length,stdout);puts("");return 0;
}}
