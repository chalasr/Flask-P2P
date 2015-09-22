(function (app) {
})(angular.module('app', ['MainCtrl'
], function($interpolateProvider) {
    $interpolateProvider.startSymbol('<%');
    $interpolateProvider.endSymbol('%>');
}));
