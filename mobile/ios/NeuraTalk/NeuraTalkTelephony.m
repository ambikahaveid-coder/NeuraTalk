#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

/**
 * Objective-C bridge for NeuraTalkTelephony Swift module
 */
@interface RCT_EXTERN_MODULE(NeuraTalkTelephony, RCTEventEmitter)

RCT_EXTERN_METHOD(initialize:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(reportIncomingCall:(NSString *)callId 
                  callerName:(NSString *)callerName
                  resolve:(RCTPromiseResolveBlock)resolve 
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(answerCall:(NSString *)callId 
                  resolve:(RCTPromiseResolveBlock)resolve 
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(endCall:(NSString *)callId 
                  resolve:(RCTPromiseResolveBlock)resolve 
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startOutgoingCall:(NSString *)phoneNumber 
                  callerName:(NSString *)callerName
                  resolve:(RCTPromiseResolveBlock)resolve 
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setMuted:(BOOL)muted 
                  resolve:(RCTPromiseResolveBlock)resolve 
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setSpeaker:(BOOL)enabled 
                  resolve:(RCTPromiseResolveBlock)resolve 
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setAudioRoute:(NSString *)route 
                  resolve:(RCTPromiseResolveBlock)resolve 
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isCallActive:(RCTPromiseResolveBlock)resolve 
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(requestPhonePermissions:(RCTPromiseResolveBlock)resolve 
                  reject:(RCTPromiseRejectBlock)reject)

@end
