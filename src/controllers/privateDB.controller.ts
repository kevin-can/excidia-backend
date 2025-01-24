import { privateDB, ClassifiedGoodType, UserRecordType } from "../config/privateDB";

export interface privateDBReq {
    username : string;
    type: UserRecordType;
    shippingID: Number;
    transactionID : Number;
}



export const privateDBGetter = async (
    req : privateDBReq,
    res : any
) : Promise<void> => {

    switch(req.type) {
        case "classified_good":
            res = await privateDB.getClassifiedList(req.username);
            return;
        case "user_registration" :
            // this data should be cached 
            // check registration data
            return;
        default:
            res = null;
            return
    }


}