import { PolarisRequestHeaders } from '@enigmatis/utills';
import { Aggregate, HookNextFunction, Model } from 'mongoose';
import { DataVersionModel } from '../data-version/data-version-model';
import { ModelConfiguration } from '../model-config';
import { RepositoryModel } from '../model-creator';
import { InnerModelType } from '../types';
import { deleted, notDeleted } from './constants';
import * as thisModule from './middleware-functions';

export const addDynamicPropertiesToDocument = <T extends RepositoryModel>(
    document: T,
    { realityId, upn, dataVersion }: PolarisRequestHeaders,
) => {
    document.lastUpdateDate = new Date();
    document.realityId = realityId!;
    document.createdBy = document.createdBy || upn;
    document.lastUpdatedBy = upn;
    document.dataVersion = dataVersion || document.dataVersion;
};

export const getPreSave = (headers: PolarisRequestHeaders) => {
    return async function preSaveFunc(this: InnerModelType<any>, next: () => void) {
        const currentDataVersion = await DataVersionModel.findOneAndUpdate(
            {},
            { $inc: { dataVersion: 1 } },
            { new: true, upsert: true },
        );
        // using thisModule to be abale to mock softRemoveFunc in tests
        headers.dataVersion = currentDataVersion.dataVersion;
        thisModule.addDynamicPropertiesToDocument(this, headers);
        next();
    };
};

export const getPreInsertMany = (headers: PolarisRequestHeaders) => {
    return async function preInsertMany(this: Model<any>, next: HookNextFunction, docs: any[]) {
        docs.forEach(doc => {
            // using thisModule to be abale to mock softRemoveFunc in tests
            thisModule.addDynamicPropertiesToDocument(doc, headers);
        });
        return next();
    };
};

export const getFindHandler = (
    headers: PolarisRequestHeaders,
    modelConfig?: ModelConfiguration,
) => {
    return function findHandler(this: any) {
        const conditions = this._conditions;
        if (modelConfig && modelConfig.softDeleteReturnEntities) {
            conditions.deleted = true;
        }
        const realityId =
            headers.realityId !== undefined &&
            conditions.realityId === undefined &&
            (headers.includeLinkedOperation
                ? { realityId: { $or: [headers.realityId, 0] } }
                : { realityId: headers.realityId });
        this.where({
            ...realityId,
            ...(!conditions.deleted && notDeleted),
            ...(headers.dataVersion &&
                !conditions.dataVersion && { dataVersion: { $gt: headers.dataVersion } }),
        });
    };
};

export function softRemove<T>(
    this: Model<any>,
    query: any,
    optionsOrCallback: any,
    callback?: (err: any, raw: any) => void,
) {
    const single = optionsOrCallback && (optionsOrCallback as any).single;
    let callbackFunc = callback;
    let options = {};
    if (typeof optionsOrCallback === 'function') {
        callbackFunc = optionsOrCallback;
    } else {
        options = optionsOrCallback;
    }
    if (single) {
        return this.updateOne(query, deleted, options, callbackFunc as any);
    } else {
        return this.updateMany(query, deleted, options, callbackFunc as any);
    }
}

export function softRemoveOne(
    this: Model<any>,
    query: any,
    callback?: (err: any, raw: any) => void,
) {
    // using thisModule to be abale to mock softRemoveFunc in tests
    return thisModule.softRemove.call(this, query, { single: true }, callback);
}

export function findOneAndSoftDelete(
    this: Model<any>,
    first: any,
    second?: any,
    callback?: (err: any, raw: any) => void,
) {
    if (typeof first !== 'function') {
        return this.findOneAndUpdate(first, deleted, second, callback);
    } else {
        return this.findOneAndUpdate(deleted, first);
    }
}

export function preAggregate(this: Aggregate<any>) {
    this.pipeline().push({ $match: notDeleted });
}

export const getCollectionName = (collectionPrefix: string, { realityId }: PolarisRequestHeaders) =>
    `${collectionPrefix}_reality-${realityId}`;
