
// TODO: change to one action type , like: CHANGE_BASE_INFO
import { CHANGE_LANGUAGE, TELL_CLIENT_URL } from '../action-types'
export { CHANGE_LANGUAGE, TELL_CLIENT_URL }

export const SERVER_REDUCER_NAME = 'server'

export const serverReducer = (state = { lang: 'en', origin: '' }, action) => {
    switch (action.type) {
        case CHANGE_LANGUAGE:
            return Object.assign({}, state, {
                lang: action.data
            })
        case TELL_CLIENT_URL:
            return Object.assign({}, state, {
                origin: action.data
            })
        default:
            return state
    }
}